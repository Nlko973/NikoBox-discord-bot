import type { Client, GuildMember, Interaction, VoiceState } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { PlayerState, RepeatMode, SeekMode } from "@nikobox/shared";
import { formatDuration } from "@nikobox/shared";
import type { LavalinkClient } from "../lavalink/LavalinkClient.js";
import { GuildPlayer } from "./GuildPlayer.js";

interface VoicePacket {
  token?: string;
  endpoint?: string;
  sessionId?: string;
  channelId?: string;
}

interface VoiceWaiter {
  channelId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class PlayerManager {
  private readonly players = new Map<string, GuildPlayer>();
  private readonly voice = new Map<string, VoicePacket>();
  private readonly voiceWaiters = new Map<string, VoiceWaiter>();

  constructor(private readonly client: Client, private readonly lavalink: LavalinkClient) {
    lavalink.on("event", (event) => {
      const payload = event as { type?: string; guildId?: string; reason?: string };
      if (payload.type === "TrackEndEvent" && payload.guildId) {
        void this.get(payload.guildId).handleTrackEnd(payload.reason);
      }
    });
    lavalink.on("playerUpdate", (event) => {
      const payload = event as { guildId?: string; state?: { position?: number } };
      if (!payload.guildId || typeof payload.state?.position !== "number") return;
      const player = this.players.get(payload.guildId);
      player?.emit("position", payload.state.position);
    });
    lavalink.on("session", () => {
      for (const guildId of this.voice.keys()) {
        void this.flushVoice(guildId);
      }
    });
  }

  get(guildId: string) {
    let player = this.players.get(guildId);
    if (!player) {
      player = new GuildPlayer(guildId, this.lavalink, this.joinVoice.bind(this), this.leaveVoice.bind(this));
      this.players.set(guildId, player);
    }
    return player;
  }

  states(): PlayerState[] {
    return [...this.players.values()].map((player) => player.snapshot());
  }

  state(guildId: string) {
    return this.get(guildId).snapshot();
  }

  async handleRaw(packet: { t?: string; d?: Record<string, unknown> }) {
    if (!packet.t || !packet.d) return;
    if (packet.t === "VOICE_SERVER_UPDATE") {
      const guildId = String(packet.d.guild_id);
      const current = this.voice.get(guildId) ?? {};
      current.token = this.optionalString(packet.d.token);
      current.endpoint = this.optionalString(packet.d.endpoint);
      this.voice.set(guildId, current);
      await this.flushVoice(guildId);
    }
    if (packet.t === "VOICE_STATE_UPDATE" && packet.d.user_id === this.client.user?.id) {
      const guildId = String(packet.d.guild_id);
      const current = this.voice.get(guildId) ?? {};
      current.sessionId = this.optionalString(packet.d.session_id);
      current.channelId = this.optionalString(packet.d.channel_id) ?? current.channelId;
      this.voice.set(guildId, current);
      await this.flushVoice(guildId);
    }
  }

  async handleInteraction(interaction: Interaction) {
    if (!interaction.isChatInputCommand() || !interaction.guildId) return;
    const player = this.get(interaction.guildId);
    const member = interaction.member as GuildMember | null;
    const voiceChannelId = member?.voice.channelId;

    try {
      if (interaction.commandName === "play") {
        if (!voiceChannelId) throw new Error("Join a voice channel first.");
        await interaction.deferReply();
        const query = interaction.options.getString("query", true);
        const result = await player.add(query, interaction.user.username, voiceChannelId, interaction.channel ?? undefined);
        await interaction.editReply(`Added ${result.tracks.length} track(s).${result.notice ? ` ${result.notice}` : ""}`);
        return;
      }
      if (interaction.commandName === "pause") await player.pause();
      if (interaction.commandName === "resume") await player.resume();
      if (interaction.commandName === "skip") await player.skip();
      if (interaction.commandName === "stop") await player.stop();
      if (interaction.commandName === "shuffle") {
        const next = !player.snapshot().shuffle;
        player.setShuffle(next);
        await interaction.reply({ content: `Shuffle ${next ? "enabled" : "disabled"}.`, ephemeral: true });
        return;
      }
      if (interaction.commandName === "repeat") {
        player.setRepeat(interaction.options.getString("mode", true) as RepeatMode);
        await interaction.reply({ content: `Repeat mode: ${player.snapshot().repeat}.`, ephemeral: true });
        return;
      }
      if (interaction.commandName === "volume") await player.setVolume(interaction.options.getInteger("value", true));
      if (interaction.commandName === "seek") {
        await player.seek(interaction.options.getString("timestamp", true), (interaction.options.getString("mode") ?? "absolute") as SeekMode);
      }
      if (interaction.commandName === "queue") {
        await interaction.reply({ embeds: [this.queueEmbed(player.snapshot())], ephemeral: true });
        return;
      }
      if (interaction.commandName === "nowplaying") {
        await interaction.reply({ embeds: [this.nowPlayingEmbed(player.snapshot())], ephemeral: true });
        return;
      }
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Done.", ephemeral: true });
    } catch (error) {
      const content = error instanceof Error ? error.message : "Command failed.";
      if (interaction.deferred) await interaction.editReply(content);
      else await interaction.reply({ content, ephemeral: true });
    }
  }

  private async joinVoice(guildId: string, channelId: string) {
    const current = this.voice.get(guildId);
    if (current?.channelId === channelId && current.token && current.endpoint && current.sessionId) {
      await this.flushVoice(guildId);
      return;
    }

    this.clearVoiceWaiter(guildId);
    this.voice.set(guildId, { channelId });

    const guild = await this.client.guilds.fetch(guildId);
    const ready = this.waitForVoice(guildId, channelId);
    guild.shard.send({
      op: 4,
      d: {
        guild_id: guildId,
        channel_id: channelId,
        self_mute: false,
        self_deaf: true
      }
    });
    await ready;
  }

  private async leaveVoice(guildId: string) {
    this.clearVoiceWaiter(guildId);
    const guild = await this.client.guilds.fetch(guildId);
    guild.shard.send({ op: 4, d: { guild_id: guildId, channel_id: null, self_mute: false, self_deaf: true } });
    await this.lavalink.destroy(guildId);
    this.voice.delete(guildId);
  }

  private async flushVoice(guildId: string) {
    const packet = this.voice.get(guildId);

    if (!packet?.token || !packet.endpoint || !packet.sessionId || !packet.channelId) return;
    if (!this.lavalink.ready) return;

    console.log("[VOICE UPDATE]", {
      ...packet,
      token: "[redacted]"
    });

    await this.lavalink.updateVoice(guildId, {
      token: packet.token,
      endpoint: packet.endpoint,
      sessionId: packet.sessionId,
      channelId: packet.channelId
    });

    this.resolveVoiceWaiter(guildId, packet.channelId);
  }

  private waitForVoice(guildId: string, channelId: string) {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.voiceWaiters.delete(guildId);
        reject(new Error("Timed out waiting for Discord voice connection details."));
      }, 10_000);

      this.voiceWaiters.set(guildId, { channelId, resolve, reject, timeout });
      void this.flushVoice(guildId);
    });
  }

  private resolveVoiceWaiter(guildId: string, channelId: string) {
    const waiter = this.voiceWaiters.get(guildId);
    if (!waiter || waiter.channelId !== channelId) return;
    clearTimeout(waiter.timeout);
    this.voiceWaiters.delete(guildId);
    waiter.resolve();
  }

  private clearVoiceWaiter(guildId: string) {
    const waiter = this.voiceWaiters.get(guildId);
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    this.voiceWaiters.delete(guildId);
    waiter.reject(new Error("Voice connection was replaced."));
  }

  private optionalString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private queueEmbed(state: PlayerState) {
    const current = state.current ? `Now: ${state.current.title} (${formatDuration(state.positionMs)} / ${formatDuration(state.current.durationMs)})` : "Nothing playing";
    const queue = state.queue.slice(0, 10).map((track, index) => `${index + 1}. ${track.title} - ${track.author}`).join("\n") || "Queue is empty.";
    return new EmbedBuilder().setTitle("NikoBox Queue").setDescription(`${current}\n\n${queue}`).setFooter({ text: `Volume ${state.volume}% | Repeat ${state.repeat} | Shuffle ${state.shuffle ? "on" : "off"}` });
  }

  private nowPlayingEmbed(state: PlayerState) {
    const track = state.current;
    if (!track) return new EmbedBuilder().setTitle("Now Playing").setDescription("Nothing is playing.");
    return new EmbedBuilder()
      .setTitle(track.title)
      .setURL(track.uri ?? null)
      .setAuthor({ name: track.author })
      .setThumbnail(track.artworkUrl ?? null)
      .setDescription(`${formatDuration(state.positionMs)} / ${formatDuration(track.durationMs)}`)
      .setFooter({ text: `Requested by ${track.requestedBy}` });
  }
}
