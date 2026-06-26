export type RepeatMode = "off" | "track" | "queue";

export type TrackSource = "youtube" | "spotify" | "search";

export interface Track {
  id: string;
  title: string;
  author: string;
  uri?: string;
  artworkUrl?: string;
  durationMs: number;
  isStream: boolean;
  requestedBy: string;
  source: TrackSource;
  lavalinkTrack?: string;
}

export interface PlayerState {
  guildId: string;
  voiceChannelId?: string;
  textChannelId?: string;
  current?: Track;
  playbackNotice?: string;
  queue: Track[];
  paused: boolean;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  positionMs: number;
  updatedAt: number;
  connected: boolean;
}

export interface GuildSummary {
  id: string;
  name: string;
  iconUrl?: string;
}

export type SeekMode = "absolute" | "forward" | "backward";

export interface DashboardEvent {
  type: "state";
  guildId: string;
  state: PlayerState;
}

export const clampVolume = (volume: number) => Math.max(0, Math.min(150, Math.round(volume)));

export function parseTimestamp(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part) || part < 0)) {
    throw new Error("Invalid timestamp. Use seconds, mm:ss, or hh:mm:ss.");
  }
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  throw new Error("Invalid timestamp. Use seconds, mm:ss, or hh:mm:ss.");
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss.padStart(5, "0")}` : mmss;
}
