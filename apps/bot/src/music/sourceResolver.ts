import type { LavalinkClient, LavalinkTrack } from "../lavalink/LavalinkClient.js";
import type { TrackSource } from "@nikobox/shared";

export interface ResolvedInput {
  tracks: LavalinkTrack[];
  source: TrackSource;
  notice?: string;
  isPlaylist?: boolean;
}

const spotifyRegex = /open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/;
const yandexRegex = /music\.yandex\.[^/]+\/(?:album|users|playlists|track)\//;
const yandexPlaylistRegex = /music\.yandex\.[^/]+\/users\/([^/?#]+)\/playlists\/(\d+)/;
const vkRegex = /vk\.com\/audio|vk\.com\/music|vk\.com\/audios/;
const urlRegex = /^https?:\/\//i;
const youtubePlaylistRegex = /(?:youtube\.com|youtu\.be)\/.*[?&]list=/i;
const playlistLimit = 1000;

export async function resolveInput(lavalink: LavalinkClient, input: string): Promise<ResolvedInput> {
  const trimmed = input.trim();

  if (spotifyRegex.test(trimmed)) {
    const query = await metadataFallbackQuery(trimmed, "Spotify");
    return {
      tracks: await lavalink.loadTracks(`ytsearch:${query}`),
      source: "spotify",
      isPlaylist: false,
      notice: "Spotify metadata fallback used. Configure provider credentials for richer matching."
    };
  }

  if (yandexRegex.test(trimmed)) {
    const playlistQueries = await yandexPlaylistQueries(trimmed);
    if (playlistQueries.length > 0) {
      return {
        tracks: await loadSearchQueries(lavalink, playlistQueries.slice(0, playlistLimit)),
        source: "yandex",
        isPlaylist: true,
        notice: `Yandex Music public playlist metadata fallback used. Added up to ${playlistLimit} tracks.`
      };
    }

    const query = await metadataFallbackQuery(trimmed, "Yandex Music");
    return {
      tracks: await lavalink.loadTracks(`ytsearch:${query}`),
      source: "yandex",
      isPlaylist: false,
      notice: "Yandex Music metadata fallback used. Private API metadata can be added with YANDEX_MUSIC_TOKEN."
    };
  }

  if (vkRegex.test(trimmed)) {
    const query = await metadataFallbackQuery(trimmed, "VK Music");
    return {
      tracks: await lavalink.loadTracks(`ytsearch:${query}`),
      source: "vk",
      isPlaylist: false,
      notice: "VK Music metadata fallback used. Private API metadata can be added with VK_ACCESS_TOKEN."
    };
  }

  if (urlRegex.test(trimmed)) {
    return { tracks: await lavalink.loadTracks(trimmed), source: "youtube", isPlaylist: youtubePlaylistRegex.test(trimmed) };
  }

  return { tracks: await lavalink.loadTracks(`ytsearch:${trimmed}`), source: "search", isPlaylist: false };
}

async function metadataFallbackQuery(url: string, service: string) {
  const pageTitle = await fetchPageTitle(url);
  if (pageTitle) return `${pageTitle} audio`;

  const cleanUrl = stripTracking(url);
  const readable = decodeURIComponent(cleanUrl)
    .replace(/^https?:\/\//, "")
    .replace(/[/?#=&._-]+/g, " ")
    .replace(/\b(open|com|ru|music|album|playlist|playlists|track|users|spotify|yandex|vk|audio|audios)\b/gi, "")
    .trim();
  return readable ? `${readable} audio` : `${service} track audio`;
}

async function yandexPlaylistQueries(url: string) {
  const match = yandexPlaylistRegex.exec(url);
  if (!match) return [];

  const owner = decodeURIComponent(match[1]);
  const kind = match[2];
  const endpoint = `https://music.yandex.ru/handlers/playlist.jsx?owner=${encodeURIComponent(owner)}&kinds=${encodeURIComponent(kind)}&light=true`;
  const response = await fetchWithTimeout(endpoint);
  if (!response?.ok) return [];

  const data = await response.json() as {
    playlist?: { tracks?: YandexTrack[] };
    tracks?: YandexTrack[];
  };
  const tracks = data.playlist?.tracks ?? data.tracks ?? [];

  return tracks.map(yandexTrackQuery).filter((query): query is string => Boolean(query));
}

interface YandexTrack {
  title?: string;
  artists?: Array<{ name?: string }>;
  track?: YandexTrack;
}

function yandexTrackQuery(item: YandexTrack) {
  const track = item.track ?? item;
  const title = track.title?.trim();
  if (!title) return undefined;
  const artists = track.artists?.map((artist) => artist.name).filter(Boolean).join(" ");
  return [artists, title].filter(Boolean).join(" ");
}

async function loadSearchQueries(lavalink: LavalinkClient, queries: string[]) {
  const tracks: LavalinkTrack[] = [];
  const concurrency = 5;

  for (let index = 0; index < queries.length; index += concurrency) {
    const chunk = queries.slice(index, index + concurrency);
    const results = await Promise.all(chunk.map((query) => lavalink.loadTracks(`ytsearch:${query}`).catch(() => [])));
    for (const result of results) {
      const track = result[0];
      if (track) tracks.push(track);
    }
  }

  return tracks;
}

async function fetchPageTitle(url: string) {
  const response = await fetchWithTimeout(stripTracking(url));
  if (!response?.ok) return undefined;

  const html = await response.text();
  const title =
    metaContent(html, "og:title") ??
    metaContent(html, "twitter:title") ??
    /<title[^>]*>(.*?)<\/title>/is.exec(html)?.[1];

  return title ? decodeHtml(title).replace(/\s*[-—|]\s*Яндекс Музыка\s*$/i, "").trim() : undefined;
}

function metaContent(html: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyFirst = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i").exec(html)?.[1];
  if (propertyFirst) return propertyFirst;
  return new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i").exec(html)?.[1];
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 NikoBox/1.0",
        Accept: "text/html,application/json"
      }
    });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function stripTracking(url: string) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "ref_id") parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
