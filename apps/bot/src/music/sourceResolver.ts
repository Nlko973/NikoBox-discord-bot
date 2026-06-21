import type { LavalinkClient, LavalinkTrack } from "../lavalink/LavalinkClient.js";
import type { TrackSource } from "@nikobox/shared";

export interface ResolvedInput {
  tracks: LavalinkTrack[];
  source: TrackSource;
  notice?: string;
}

const spotifyRegex = /open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/;
const yandexRegex = /music\.yandex\.[^/]+\/(?:album|users|playlists|track)\//;
const vkRegex = /vk\.com\/audio|vk\.com\/music|vk\.com\/audios/;
const urlRegex = /^https?:\/\//i;

export async function resolveInput(lavalink: LavalinkClient, input: string): Promise<ResolvedInput> {
  const trimmed = input.trim();

  if (spotifyRegex.test(trimmed)) {
    const query = await metadataFallbackQuery(trimmed, "Spotify");
    return {
      tracks: await lavalink.loadTracks(`ytsearch:${query}`),
      source: "spotify",
      notice: "Spotify metadata fallback used. Configure provider credentials for richer matching."
    };
  }

  if (yandexRegex.test(trimmed)) {
    const query = await metadataFallbackQuery(trimmed, "Yandex Music");
    return {
      tracks: await lavalink.loadTracks(`ytsearch:${query}`),
      source: "yandex",
      notice: "Yandex Music metadata fallback used. Private API metadata can be added with YANDEX_MUSIC_TOKEN."
    };
  }

  if (vkRegex.test(trimmed)) {
    const query = await metadataFallbackQuery(trimmed, "VK Music");
    return {
      tracks: await lavalink.loadTracks(`ytsearch:${query}`),
      source: "vk",
      notice: "VK Music metadata fallback used. Private API metadata can be added with VK_ACCESS_TOKEN."
    };
  }

  if (urlRegex.test(trimmed)) {
    return { tracks: await lavalink.loadTracks(trimmed), source: "youtube" };
  }

  return { tracks: await lavalink.loadTracks(`ytsearch:${trimmed}`), source: "search" };
}

async function metadataFallbackQuery(url: string, service: string) {
  const readable = decodeURIComponent(url)
    .replace(/^https?:\/\//, "")
    .replace(/[/?#=&._-]+/g, " ")
    .replace(/\b(open|com|music|album|playlist|track|users|spotify|yandex|vk|audio|audios)\b/gi, "")
    .trim();
  return readable ? `${readable} audio` : `${service} track audio`;
}
