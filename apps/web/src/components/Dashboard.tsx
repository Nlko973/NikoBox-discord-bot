"use client";

import { useEffect, useMemo, useState } from "react";
import { Pause, Play, Plus, RotateCcw, Shuffle, SkipForward, Square, Trash2 } from "lucide-react";
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

  useEffect(() => {
    if (!token) return;
    void loadGuilds();
  }, [token]);

  useEffect(() => {
    if (!guildId || !token) return;
    void loadState(guildId);
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
  const progress = current ? Math.min(100, (view.positionMs / current.durationMs) * 100) : 0;

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <h1>NikoBox</h1>
          <p>{selected ? selected.name : "Discord music dashboard"}</p>
        </div>
        <input className="token" type="password" placeholder="Admin token" value={token} onChange={(event) => setToken(event.target.value)} />
      </section>

      <section className="controls">
        <select value={guildId} onChange={(event) => setGuildId(event.target.value)}>
          <option value="">Select guild</option>
          {guilds.map((guild) => (
            <option key={guild.id} value={guild.id}>{guild.name}</option>
          ))}
        </select>
        <input value={voiceChannelId} onChange={(event) => setVoiceChannelId(event.target.value)} placeholder="Voice channel ID for dashboard play" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Link or search text" />
        <button title="Add to queue" onClick={() => action("play", { query, voiceChannelId }).then(() => setQuery(""))}>
          <Plus size={18} /> Add
        </button>
      </section>

      {view && (
        <section className="player">
          <div className="art">{current?.artworkUrl ? <img src={current.artworkUrl} alt="" /> : <span>NB</span>}</div>
          <div className="track">
            <h2>{current?.title ?? "Nothing playing"}</h2>
            <p>{current?.author ?? "Queue a track from Discord or the dashboard"}</p>
            <input className="progress" type="range" min={0} max={current?.durationMs ?? 1} value={Math.min(view.positionMs, current?.durationMs ?? 1)} onChange={(event) => action("seek", { value: Number(event.target.value), mode: "absolute" })} />
            <div className="time"><span>{formatDuration(view.positionMs)}</span><span>{formatDuration(current?.durationMs ?? 0)}</span></div>
          </div>
          <div className="transport">
            <button title={view.paused ? "Resume" : "Pause"} onClick={() => action(view.paused ? "resume" : "pause")}>{view.paused ? <Play /> : <Pause />}</button>
            <button title="Skip" onClick={() => action("skip")}><SkipForward /></button>
            <button title="Stop" onClick={() => action("stop")}><Square /></button>
          </div>
        </section>
      )}

      {view && (
        <section className="mix">
          <label>Volume <input type="range" min={0} max={150} value={view.volume} onChange={(event) => action("volume", { volume: Number(event.target.value) })} /></label>
          <button className={view.shuffle ? "active" : ""} title="Shuffle" onClick={() => action("shuffle", { shuffle: !view.shuffle })}><Shuffle size={18} /> Shuffle</button>
          <select value={view.repeat} onChange={(event) => action("repeat", { repeat: event.target.value as RepeatMode })}>
            <option value="off">Repeat off</option>
            <option value="track">Repeat track</option>
            <option value="queue">Repeat queue</option>
          </select>
          <input value={seekText} onChange={(event) => setSeekText(event.target.value)} placeholder="Seek mm:ss" />
          <button title="Seek absolute" onClick={() => action("seek", { value: seekText, mode: "absolute" })}><RotateCcw size={18} /> Seek</button>
        </section>
      )}

      {view && (
        <section className="queue">
          <div className="queueHead">
            <h2>Queue</h2>
            <button title="Clear queue" onClick={() => action("clear")}><Trash2 size={18} /> Clear</button>
          </div>
          {view.queue.map((track, index) => (
            <article key={track.id} className="queueRow">
              <span>{index + 1}</span>
              <div><strong>{track.title}</strong><small>{track.author} · {formatDuration(track.durationMs)}</small></div>
              <button onClick={() => action("reorder", { from: index, to: Math.max(0, index - 1) })}>Up</button>
              <button onClick={() => action("reorder", { from: index, to: Math.min(view.queue.length - 1, index + 1) })}>Down</button>
              <button title="Remove" onClick={() => action("remove", { index })}><Trash2 size={16} /></button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
