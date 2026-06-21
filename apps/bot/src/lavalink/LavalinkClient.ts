import { EventEmitter } from "node:events";
import WebSocket from "ws";

export interface LavalinkTrackInfo {
  identifier: string;
  isSeekable: boolean;
  author: string;
  length: number;
  isStream: boolean;
  position: number;
  title: string;
  uri?: string;
  artworkUrl?: string;
  sourceName: string;
}

export interface LavalinkTrack {
  encoded: string;
  info: LavalinkTrackInfo;
}

export interface LoadResult {
  loadType: "track" | "playlist" | "search" | "empty" | "error";
  data?: LavalinkTrack | LavalinkTrack[] | { tracks: LavalinkTrack[]; info: { name: string } };
}

interface LavalinkOptions {
  host: string;
  port: number;
  password: string;
  secure: boolean;
  userId: string;
}

export class LavalinkClient extends EventEmitter {
  private sessionId?: string;
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(private readonly options: LavalinkOptions) {
    super();
  }

  connect() {
    const protocol = this.options.secure ? "wss" : "ws";
    const url = `${protocol}://${this.options.host}:${this.options.port}/v4/websocket`;
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: this.options.password,
        "User-Id": this.options.userId,
        "Client-Name": "NikoBox/1.0"
      }
    });

    this.ws.on("open", () => this.emit("ready"));
    this.ws.on("message", (raw) => this.handleMessage(raw.toString()));
    this.ws.on("close", () => {
      this.emit("closed");
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    });
    this.ws.on("error", (error) => this.emit("error", error));
  }

  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  get ready() {
    return Boolean(this.sessionId);
  }

  async loadTracks(identifier: string): Promise<LavalinkTrack[]> {
    const result = await this.request<LoadResult>(`/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`);
    if (result.loadType === "track" && result.data && !Array.isArray(result.data) && "encoded" in result.data) {
      return [result.data];
    }
    if (result.loadType === "search" && Array.isArray(result.data)) return result.data;
    if (result.loadType === "playlist" && result.data && !Array.isArray(result.data) && "tracks" in result.data) {
      return result.data.tracks;
    }
    return [];
  }

  async updateVoice(guildId: string, voice: { token: string; endpoint: string; sessionId: string; channelId: string; }) {
    await this.patchPlayer(guildId, { voice });
  }

  async play(guildId: string, encodedTrack: string, options: { volume?: number; positionMs?: number } = {}) {
    await this.patchPlayer(guildId, {
      track: { encoded: encodedTrack },
      volume: options.volume,
      position: options.positionMs
    });
  }

  async pause(guildId: string, paused: boolean) {
    await this.patchPlayer(guildId, { paused });
  }

  async stop(guildId: string) {
    await this.patchPlayer(guildId, { track: { encoded: null } });
  }

  async volume(guildId: string, volume: number) {
    await this.patchPlayer(guildId, { volume });
  }

  async seek(guildId: string, positionMs: number) {
    await this.patchPlayer(guildId, { position: Math.max(0, Math.floor(positionMs)) });
  }

  async destroy(guildId: string) {
    if (!this.sessionId) return;
    await this.request(`/v4/sessions/${this.sessionId}/players/${guildId}`, { method: "DELETE" });
  }

  private async patchPlayer(guildId: string, body: unknown) {
  if (!this.sessionId) throw new Error("Lavalink session is not ready");

  console.log(
    "[PATCH PLAYER]",
    JSON.stringify(body, null, 2)
  );

  await this.request(
    `/v4/sessions/${this.sessionId}/players/${guildId}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" }
    }
  );
}

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const protocol = this.options.secure ? "https" : "http";
    const response = await fetch(`${protocol}://${this.options.host}:${this.options.port}${path}`, {
      ...init,
      headers: {
        Authorization: this.options.password,
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) {
  const text = await response.text();

  console.error("[LAVALINK ERROR RESPONSE]", {
    url: `${protocol}://${this.options.host}:${this.options.port}${path}`,
    status: response.status,
    body: text,
  });

  throw new Error(`Lavalink ${response.status}: ${text}`);
}
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private handleMessage(raw: string) {
    const message = JSON.parse(raw) as { op: string; sessionId?: string; type?: string; guildId?: string; state?: { position?: number; time?: number } };
    if (message.op === "ready" && message.sessionId) {
      this.sessionId = message.sessionId;
      this.emit("session", message.sessionId);
      return;
    }
    if (message.op === "event") this.emit("event", message);
    if (message.op === "playerUpdate") this.emit("playerUpdate", message);
  }
}
