import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { TextBasedChannel } from "discord.js";
import { clampVolume, type PlayerState, type RepeatMode, type SeekMode, type Track } from "@nikobox/shared";
import { parseTimestamp } from "@nikobox/shared";
import type { LavalinkClient, LavalinkTrack } from "../lavalink/LavalinkClient.js";
import { resolveInput } from "./sourceResolver.js";

export class GuildPlayer extends EventEmitter {
  private state: PlayerState;

  constructor(
    private readonly guildId: string,
    private readonly lavalink: LavalinkClient,
    private readonly joinVoice: (guildId: string, channelId: string) => Promise<void>,
    private readonly leaveVoice: (guildId: string) => Promise<void>
  ) {
    super();
    this.state = {
      guildId,
      queue: [],
      paused: false,
      volume: 80,
      repeat: "off",
      shuffle: false,
      positionMs: 0,
      updatedAt: Date.now(),
      connected: false
    };
  }

  snapshot(): PlayerState {
    const elapsed = !this.state.paused && this.state.current ? Date.now() - this.state.updatedAt : 0;
    return { ...this.state, positionMs: this.state.positionMs + elapsed, queue: [...this.state.queue] };
  }

  async add(input: string, requestedBy: string, voiceChannelId: string, textChannel?: TextBasedChannel) {
    await this.joinVoice(this.guildId, voiceChannelId);
    this.state.voiceChannelId = voiceChannelId;
    this.state.textChannelId = textChannel?.id;
    this.state.connected = true;

    const resolved = await resolveInput(this.lavalink, input);
    let tracks = resolved.tracks.map((track) =>
  this.toTrack(track, requestedBy, resolved.source)
);

if (resolved.source === "youtube" || resolved.tracks.length > 1 && !resolved.isPlaylist) {
  tracks = tracks.slice(0, 1);
}
    if (tracks.length === 0) throw new Error("No tracks found.");
    this.state.queue.push(...tracks);
    this.emitState();
    if (!this.state.current) await this.playNext();
    return { tracks, notice: resolved.notice };
  }

  async playTrack(track: Track, positionMs = 0) {
    if (!track.lavalinkTrack) throw new Error("Track has no Lavalink payload");
    this.state.current = track;
    this.state.positionMs = positionMs;
    this.state.updatedAt = Date.now();
    this.state.paused = false;
    await this.lavalink.play(this.guildId, track.lavalinkTrack, { volume: this.state.volume, positionMs });
    this.emitState();
  }

  async playNext() {
    const next = this.state.shuffle ? this.takeRandom() : this.state.queue.shift();
    if (!next) {
      this.state.current = undefined;
      this.state.positionMs = 0;
      await this.lavalink.stop(this.guildId);
      this.emitState();
      return;
    }
    await this.playTrack(next);
  }

  async handleTrackEnd(reason?: string) {
    const current = this.state.current;
    if (current && reason !== "REPLACED") {
      if (this.state.repeat === "track") this.state.queue.unshift(current);
      if (this.state.repeat === "queue") this.state.queue.push(current);
    }
    await this.playNext();
  }

  async pause() {
    this.freezePosition();
    this.state.paused = true;
    await this.lavalink.pause(this.guildId, true);
    this.emitState();
  }

  async resume() {
    this.state.paused = false;
    this.state.updatedAt = Date.now();
    await this.lavalink.pause(this.guildId, false);
    this.emitState();
  }

  async skip() {
    await this.handleTrackEnd("SKIPPED");
  }

  async stop() {
    this.state.current = undefined;
    this.state.queue = [];
    this.state.positionMs = 0;
    this.state.paused = false;
    await this.lavalink.stop(this.guildId);
    await this.leaveVoice(this.guildId);
    this.state.connected = false;
    this.emitState();
  }

  async setVolume(volume: number) {
    this.state.volume = clampVolume(volume);
    await this.lavalink.volume(this.guildId, this.state.volume);
    this.emitState();
  }

  async seek(value: string | number, mode: SeekMode = "absolute") {
    const current = this.snapshot().current;
    if (!current) throw new Error("Nothing is playing.");
    const delta = typeof value === "number" ? value : parseTimestamp(value);
    const base = mode === "absolute" ? 0 : this.snapshot().positionMs;
    const signed = mode === "backward" ? -delta : delta;
    const position = Math.max(0, Math.min(current.durationMs, base + signed));
    this.state.positionMs = position;
    this.state.updatedAt = Date.now();
    await this.lavalink.seek(this.guildId, position);
    this.emitState();
  }

  setRepeat(mode: RepeatMode) {
    this.state.repeat = mode;
    this.emitState();
  }

  setShuffle(value: boolean) {
    this.state.shuffle = value;
    this.emitState();
  }

  remove(index: number) {
    this.state.queue.splice(index, 1);
    this.emitState();
  }

  clear() {
    this.state.queue = [];
    this.emitState();
  }

  reorder(from: number, to: number) {
    const [track] = this.state.queue.splice(from, 1);
    if (track) this.state.queue.splice(to, 0, track);
    this.emitState();
  }

  private toTrack(track: LavalinkTrack, requestedBy: string, source: Track["source"]): Track {
    return {
      id: randomUUID(),
      title: track.info.title,
      author: track.info.author,
      uri: track.info.uri,
      artworkUrl: track.info.artworkUrl,
      durationMs: track.info.length,
      isStream: track.info.isStream,
      requestedBy,
      source,
      lavalinkTrack: track.encoded
    };
  }

  private takeRandom() {
    if (this.state.queue.length === 0) return undefined;
    const index = Math.floor(Math.random() * this.state.queue.length);
    return this.state.queue.splice(index, 1)[0];
  }

  private freezePosition() {
    this.state = this.snapshot();
  }

  private emitState() {
    this.state.updatedAt = Date.now();
    this.emit("state", this.snapshot());
  }
}
