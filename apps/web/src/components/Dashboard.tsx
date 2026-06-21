"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ListMusic, Pause, Play, Plus, RotateCcw, Shuffle, SkipForward, Square, Trash2, Volume2, Wifi } from "lucide-react";
import type { DashboardEvent, GuildSummary, PlayerState, RepeatMode } from "@nikobox/shared";
import { formatDuration } from "@nikobox/shared";

const emptyState = (guildId: string): PlayerState => ({
  guildId,
  queue: [],
  paused: false,
  volume: 80,
  repeat: "off",
  shuffle: false,
  positionMs: 0,
  updatedAt: Date.now(),
  connected: false
});

export function Dashboard({ wsUrl }: { wsUrl: string }) {
  const [token, setToken] = useState("");
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [guildId, setGuildId] = useState("");
  const [state, setState] = useState<PlayerState | null>(null);
  const [query, setQuery] = useState("");
  const [voiceChannelId, setVoiceChannelId] = useState("");
  const [seekText, setSeekText] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const selected = useMemo(() => guilds.find((guild) => guild.id === guildId), [guildId, guilds]);

  async function api(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw new Error((await response.json()).error ?? "Request failed");
    return response.json();
  }

  async function run<T>(label: string, task: () => Promise<T>) {
    setBusyAction(label);
    setError("");
    try {
      return await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
      throw caught;
    } finally {
      setBusyAction(null);
    }
  }

  async function loadGuilds() {
    const data = (await api("/api/bot/guilds")) as GuildSummary[];
    setGuilds(data);
    setGuildId((current) => current || data[0]?.id || "");
  }

  async function loadState(id = guildId) {
    if (!id) return;
    setState((await api(`/api/bot/guilds/${id}/state`)) as PlayerState);
  }

  async function action(name: string, body: unknown = {}) {
    if (!guildId) return;
    const next = (await api(`/api/bot/guilds/${guildId}/${name}`, body)) as PlayerState;
    setState(next);
  }

  async function submitPlay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() || !voiceChannelId.trim()) {
      setError("Enter a search query and voice channel ID.");
      return;
    }
    await run("play", async () => {
      await action("play", { query: query.trim(), voiceChannelId: voiceChannelId.trim() });
      setQuery("");
    });
  }

  useEffect(() => {
    if (!token) return;
    void run("guilds", loadGuilds).catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (!guildId || !token) return;
    void run("state", () => loadState(guildId)).catch(() => undefined);
  }, [guildId, token]);

  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (message) => {
      const event = JSON.parse(message.data) as DashboardEvent;
      if (event.type === "state" && event.guildId === guildId) setState(event.state);
    };
    return () => ws.close();
  }, [guildId, token, wsUrl]);

  const view = state ?? (guildId ? emptyState(guildId) : null);
  const current = view?.current;
  const progressValue = Math.min(view?.positionMs ?? 0, current?.durationMs ?? 1);
  const disabled = Boolean(busyAction) || !guildId;

  return (
    <main className="shell">
      <section className="topbar">
        <div className="brand">
          <span className="brandMark">NB</span>
          <div>
            <h1>NikoBox</h1>
            <p>{selected ? selected.name : "Discord music control"}</p>
          </div>
        </div>
        <div className="statusLine">
          <span className={`pill ${view?.connected ? "online" : ""}`}><Wifi size={14} />{view?.connected ? "Connected" : "Idle"}</span>
          <input className="token" type="password" placeholder="Admin token" value={token} onChange={(event) => setToken(event.target.value)} />
        </div>
      </section>

      <form className="controls" onSubmit={submitPlay}>
        <select value={guildId} onChange={(event) => setGuildId(event.target.value)} aria-label="Guild">
          <option value="">Select guild</option>
          {guilds.map((guild) => (
            <option key={guild.id} value={guild.id}>{guild.name}</option>
          ))}
        </select>
        <input value={voiceChannelId} onChange={(event) => setVoiceChannelId(event.target.value)} placeholder="Voice channel ID" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Paste a link or search for a track" />
        <button type="submit" title="Add to queue" disabled={disabled || !query.trim() || !voiceChannelId.trim()}>
          <Plus size={18} />{busyAction === "play" ? "Adding" : "Add"}
        </button>
      </form>

      {error && <div className="notice">{error}</div>}

      {view && (
        <section className="player">
          <div className="art">{current?.artworkUrl ? <img src={current.artworkUrl} alt="" /> : <ListMusic size={34} />}</div>
          <div className="track">
            <span className="eyebrow">{current ? current.source : "Ready"}</span>
            <h2>{current?.title ?? "Nothing playing"}</h2>
            <p>{current?.author ?? "Add a track from Discord or the dashboard"}</p>
            <input className="progress" type="range" min={0} max={current?.durationMs ?? 1} value={progressValue} disabled={!current || disabled} onChange={(event) => void run("seek", () => action("seek", { value: Number(event.target.value), mode: "absolute" })).catch(() => undefined)} />
            <div className="time"><span>{formatDuration(view.positionMs)}</span><span>{formatDuration(current?.durationMs ?? 0)}</span></div>
          </div>
          <div className="transport">
            <button title={view.paused ? "Resume" : "Pause"} disabled={!current || disabled} onClick={() => void run("pause", () => action(view.paused ? "resume" : "pause")).catch(() => undefined)}>{view.paused ? <Play /> : <Pause />}</button>
            <button title="Skip" disabled={!current || disabled} onClick={() => void run("skip", () => action("skip")).catch(() => undefined)}><SkipForward /></button>
            <button title="Stop" disabled={!view.connected || disabled} onClick={() => void run("stop", () => action("stop")).catch(() => undefined)}><Square /></button>
          </div>
        </section>
      )}

      {view && (
        <section className="mix">
          <label className="volume"><Volume2 size={18} /><span>{view.volume}%</span><input type="range" min={0} max={150} value={view.volume} disabled={disabled} onChange={(event) => void run("volume", () => action("volume", { volume: Number(event.target.value) })).catch(() => undefined)} /></label>
          <button className={view.shuffle ? "active" : ""} title="Shuffle" disabled={disabled} onClick={() => void run("shuffle", () => action("shuffle", { shuffle: !view.shuffle })).catch(() => undefined)}><Shuffle size={18} />Shuffle</button>
          <select value={view.repeat} disabled={disabled} onChange={(event) => void run("repeat", () => action("repeat", { repeat: event.target.value as RepeatMode })).catch(() => undefined)}>
            <option value="off">Repeat off</option>
            <option value="track">Repeat track</option>
            <option value="queue">Repeat queue</option>
          </select>
          <input value={seekText} onChange={(event) => setSeekText(event.target.value)} placeholder="Seek mm:ss" />
          <button title="Seek absolute" disabled={!current || disabled || !seekText.trim()} onClick={() => void run("seek", () => action("seek", { value: seekText, mode: "absolute" })).catch(() => undefined)}><RotateCcw size={18} />Seek</button>
        </section>
      )}

      {view && (
        <section className="queue">
          <div className="queueHead">
            <div>
              <h2>Queue</h2>
              <p>{view.queue.length} waiting</p>
            </div>
            <button title="Clear queue" disabled={disabled || view.queue.length === 0} onClick={() => void run("clear", () => action("clear")).catch(() => undefined)}><Trash2 size={18} />Clear</button>
          </div>
          {view.queue.length === 0 && <div className="emptyQueue">The queue is empty.</div>}
          {view.queue.map((track, index) => (
            <article key={track.id} className="queueRow">
              <span>{index + 1}</span>
              <div><strong>{track.title}</strong><small>{track.author} · {formatDuration(track.durationMs)}</small></div>
              <button title="Move up" disabled={disabled || index === 0} onClick={() => void run("reorder", () => action("reorder", { from: index, to: Math.max(0, index - 1) })).catch(() => undefined)}><ArrowUp size={16} /></button>
              <button title="Move down" disabled={disabled || index === view.queue.length - 1} onClick={() => void run("reorder", () => action("reorder", { from: index, to: Math.min(view.queue.length - 1, index + 1) })).catch(() => undefined)}><ArrowDown size={16} /></button>
              <button title="Remove" disabled={disabled} onClick={() => void run("remove", () => action("remove", { index })).catch(() => undefined)}><Trash2 size={16} /></button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
