import type { LavalinkClient, LavalinkTrack } from "../lavalink/LavalinkClient.js";
import type { TrackSource } from "@nikobox/shared";
import { env } from "../env.js";

export interface ResolvedInput {
  tracks: LavalinkTrack[];
  source: TrackSource;
  notice?: string;
  isPlaylist?: boolean;
}

const spotifyUrlRegex = /open\.spotify\.com\/(track|album|playlist)\/([A-Za-z0-9]+)/i;
const urlRegex = /^https?:\/\//i;
const youtubePlaylistRegex = /(?:youtube\.com|youtu\.be)\/.*[?&]list=/i;
const playlistLimit = 1000;

let spotifyTokenCache: { token: string; expiresAt: number } | undefined;

export async function resolveInput(lavalink: LavalinkClient, input: string): Promise<ResolvedInput> {
  const trimmed = input.trim();

  const spotify = parseSpotifyUrl(trimmed);
  if (spotify) {
    return resolveSpotifyInput(lavalink, trimmed, spotify.type, spotify.id);
  }

  const yandex = parseYandexUrl(trimmed);
  if (yandex) {
    return resolveYandexInput(lavalink, trimmed, yandex);
  }

  const vk = parseVkUrl(trimmed);
  if (vk) {
    return resolveVkInput(lavalink, trimmed, vk);
  }

  if (urlRegex.test(trimmed)) {
    return { tracks: await lavalink.loadTracks(trimmed), source: "youtube", isPlaylist: youtubePlaylistRegex.test(trimmed) };
  }

  return { tracks: await loadTextSearch(lavalink, trimmed), source: "search", isPlaylist: false };
}

async function resolveSpotifyInput(
  lavalink: LavalinkClient,
  url: string,
  type: "track" | "album" | "playlist",
  id: string
): Promise<ResolvedInput> {

  if (type === "track") {
    const query = await spotifyTrackQuery(url, id);

    return {
      tracks: await loadSearchQueries(lavalink, [query], loadMetadataSearch),
      source: "spotify",
      isPlaylist: false,
      notice: "Spotify track resolved via metadata fallback"
    };
  }

  const queries = await spotifyCollectionQueries(type, id);

  if (queries.length > 0) {
    return {
      tracks: await loadSearchQueries(
        lavalink,
        queries,
        loadMetadataSearch
      ),
      source: "spotify",
      isPlaylist: true,
      notice: `Spotify ${type} resolved (${queries.length} items)`
    };
  }

  const fallback = await metadataFallbackQuery(url, "Spotify");

  return {
    tracks: await loadSearchQueries(lavalink, [fallback], loadMetadataSearch),
    source: "spotify",
    isPlaylist: false,
    notice: "Spotify fallback used"
  };
}

async function resolveYandexInput(
  lavalink: LavalinkClient,
  url: string,
  input: { kind: "track" | "album" | "playlist"; owner?: string; playlistId?: string; trackId?: string; albumId?: string }
): Promise<ResolvedInput> {
  if (input.kind === "playlist") {
    const queries = await yandexPlaylistQueries(input.owner, input.playlistId);
    if (queries.length > 0) {
      return {
        tracks: await loadSearchQueries(lavalink, queries.slice(0, playlistLimit), loadMetadataSearch),
        source: "yandex",
        isPlaylist: true,
        notice: `Yandex Music playlist metadata fallback used. Added up to ${playlistLimit} tracks.`
      };
    }
  }

  if (input.kind === "album") {
    const queries = await yandexAlbumQueries(input.albumId);
    if (queries.length > 0) {
      return {
        tracks: await loadSearchQueries(lavalink, queries.slice(0, playlistLimit), loadMetadataSearch),
        source: "yandex",
        isPlaylist: true,
        notice: `Yandex Music album metadata fallback used. Added up to ${playlistLimit} tracks.`
      };
    }
  }

  if (input.kind === "track") {
    const query = await yandexTrackQuery(url, input.trackId, input.albumId);
    return {
      tracks: await loadSearchQueries(lavalink, [query], loadMetadataSearch),
      source: "yandex",
      isPlaylist: false,
      notice: "Yandex Music metadata fallback used. Private API metadata can be added with YANDEX_MUSIC_TOKEN."
    };
  }

  const query = await metadataFallbackQuery(url, "Yandex Music");
  return {
    tracks: await loadSearchQueries(lavalink, [query], loadMetadataSearch),
    source: "yandex",
    isPlaylist: false,
    notice: "Yandex Music metadata fallback used. Private API metadata can be added with YANDEX_MUSIC_TOKEN."
  };
}

async function resolveVkInput(
  lavalink: LavalinkClient,
  url: string,
  input: { kind: "track" | "album" | "playlist"; ownerId?: string; albumId?: string; audioId?: string }
): Promise<ResolvedInput> {
  if (input.kind === "track") {
    const query = await vkTrackQuery(url, input.ownerId, input.audioId);
    return {
      tracks: await loadSearchQueries(lavalink, [query], loadMetadataSearch),
      source: "vk",
      isPlaylist: false,
      notice: "VK Music metadata fallback used. Private API metadata can be added with VK_ACCESS_TOKEN."
    };
  }

  const queries = await vkCollectionQueries(input.ownerId, input.albumId);
  if (queries.length > 0) {
    return {
      tracks: await loadSearchQueries(lavalink, queries.slice(0, playlistLimit), loadMetadataSearch),
      source: "vk",
      isPlaylist: true,
      notice: `VK Music ${input.kind} metadata fallback used. Added up to ${playlistLimit} tracks.`
    };
  }

  const query = await metadataFallbackQuery(url, "VK Music");
  return {
    tracks: await loadSearchQueries(lavalink, [query], loadMetadataSearch),
    source: "vk",
    isPlaylist: false,
    notice: "VK Music metadata fallback used. Private API metadata can be added with VK_ACCESS_TOKEN."
  };
}

async function loadTextSearch(lavalink: LavalinkClient, query: string) {
  const soundCloudTracks = await lavalink.loadTracks(`scsearch:${query}`).catch(() => []);
  if (soundCloudTracks.length > 0) return soundCloudTracks;
  return lavalink.loadTracks(`ytsearch:${query}`);
}

async function loadMetadataSearch(lavalink: LavalinkClient, query: string) {
  const youTubeTracks = await lavalink.loadTracks(`ytsearch:${query}`).catch(() => []);
  if (youTubeTracks.length > 0) return youTubeTracks;
  return lavalink.loadTracks(`scsearch:${query}`);
}

async function metadataFallbackQuery(url: string, service: string) {
  const pageTitle = await fetchPageTitle(url);
  if (pageTitle) return `${pageTitle} audio`;

  const cleanUrl = stripTracking(url);
  const readable = decodeURIComponent(cleanUrl)
    .replace(/^https?:\/\//, "")
    .replace(/[/?#=&._-]+/g, " ")
    .replace(/\b(open|com|ru|music|album|playlist|playlists|track|tracks|users|spotify|yandex|vk|audio|audios)\b/gi, "")
    .trim();
  return readable ? `${readable} audio` : `${service} track audio`;
}

function parseSpotifyUrl(url: string) {
  const match = spotifyUrlRegex.exec(url);
  if (!match) return undefined;
  return { type: match[1] as "track" | "album" | "playlist", id: match[2] };
}

function parseYandexUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (!/music\.yandex\./i.test(parsed.hostname)) return undefined;

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] === "users" && segments[2] === "playlists" && segments[1] && segments[3]) {
      return { kind: "playlist" as const, owner: segments[1], playlistId: segments[3] };
    }

    if (segments[0] === "album" && segments[1]) {
      if (segments[2] === "track" && segments[3]) {
        return { kind: "track" as const, albumId: segments[1], trackId: segments[3] };
      }
      return { kind: "album" as const, albumId: segments[1] };
    }

    if (segments[0] === "track" && segments[1]) {
      return { kind: "track" as const, trackId: segments[1] };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function parseVkUrl(url: string) {
  if (!/vk\.com/i.test(url)) return undefined;

  const trackMatch = /audio(-?\d+)_(\d+)/i.exec(url);
  if (trackMatch) {
    return { kind: "track" as const, ownerId: trackMatch[1], audioId: trackMatch[2] };
  }

  const collectionMatch = /music\/(album|playlist)\/(-?\d+)_(\d+)/i.exec(url);
  if (collectionMatch) {
    return {
      kind: collectionMatch[1].toLowerCase() === "album" ? ("album" as const) : ("playlist" as const),
      ownerId: collectionMatch[2],
      albumId: collectionMatch[3]
    };
  }

  const playlistMatch = /audio_playlist\/(-?\d+)_(\d+)/i.exec(url);
  if (playlistMatch) {
    return { kind: "playlist" as const, ownerId: playlistMatch[1], albumId: playlistMatch[2] };
  }

  return undefined;
}

async function spotifyTrackQuery(url: string, id: string) {
  try {
    const track = await spotifyTrackMetadata(id);

    if (track?.title) {
      return trackQuery(track.title, track.artists ?? []);
    }
  } catch {}

  const fallback = await metadataFallbackQuery(url, "Spotify");

  return fallback || `${id} spotify track`;
}

async function spotifyCollectionQueries(type: "album" | "playlist", id: string) {
  const token = await spotifyAccessToken();
  if (!token) return [];

  const queries: string[] = [];
  let endpoint =
    type === "album"
      ? `https://api.spotify.com/v1/albums/${encodeURIComponent(id)}/tracks?limit=50`
      : `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}/tracks?limit=100&fields=items(track(name,artists(name),is_local)),next`;

  for (;;) {
    if (type === "album") {
      const data = await fetchJson<SpotifyAlbumTracksResponse>(endpoint, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!data) break;

      for (const item of data.items ?? []) {
        const query = spotifyAlbumItemQuery(item);
        if (query) queries.push(query);
      }

      if (!data.next || queries.length >= playlistLimit) break;
      endpoint = data.next;
      continue;
    }

    const data = await fetchJson<SpotifyPlaylistTracksResponse>(endpoint, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!data) break;

    for (const item of data.items ?? []) {
      const query = spotifyPlaylistItemQuery(item);
      if (query) queries.push(query);
    }

    if (!data.next || queries.length >= playlistLimit) break;
    endpoint = data.next;
  }

  return uniqueQueries(queries);
}

async function spotifyTrackMetadata(id: string) {
  const token = await spotifyAccessToken();
  if (!token) return undefined;

  const data = await fetchJson<SpotifyTrackObject>(`https://api.spotify.com/v1/tracks/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!data?.name) return undefined;

  return {
    title: data.name,
    artists: (data.artists ?? []).map((artist) => artist.name ?? "").filter(Boolean)
  };
}

async function spotifyAccessToken() {
  const now = Date.now();
  if (spotifyTokenCache && spotifyTokenCache.expiresAt > now + 30_000) return spotifyTokenCache.token;
  if (!env.spotifyClientId || !env.spotifyClientSecret) return undefined;

  const response = await fetchWithTimeout("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.spotifyClientId}:${env.spotifyClientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!response?.ok) return undefined;

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return undefined;

  spotifyTokenCache = {
    token: data.access_token,
    expiresAt: now + ((data.expires_in ?? 3600) * 1000)
  };
  return spotifyTokenCache.token;
}

async function yandexPlaylistQueries(owner?: string, playlistId?: string) {
  if (!owner || !playlistId) return [];

  const endpoint = `https://music.yandex.ru/handlers/playlist.jsx?owner=${encodeURIComponent(owner)}&kinds=${encodeURIComponent(playlistId)}&light=true`;
  const data = await fetchJson<YandexResponse>(endpoint);
  return uniqueQueries(extractYandexQueries(data));
}

async function yandexAlbumQueries(albumId?: string) {
  if (!albumId) return [];

  const endpoint = `https://music.yandex.ru/handlers/album.jsx?album=${encodeURIComponent(albumId)}&light=true`;
  const data = await fetchJson<YandexResponse>(endpoint);
  return uniqueQueries(extractYandexQueries(data));
}

async function yandexTrackQuery(url: string, trackId?: string, albumId?: string) {
  const endpoint = trackId
    ? `https://music.yandex.ru/handlers/track.jsx?track=${encodeURIComponent(trackId)}${albumId ? `&album=${encodeURIComponent(albumId)}` : ""}&light=true`
    : url;
  const data = await fetchJson<YandexResponse>(endpoint);
  const query = extractYandexQueries(data)[0];
  return query ?? metadataFallbackQuery(url, "Yandex Music");
}

async function vkTrackQuery(url: string, ownerId?: string, audioId?: string) {
  if (ownerId && audioId) {
    const items = await vkAudioById(ownerId, audioId);
    const query = items.map(vkTrackItemQuery).find((value): value is string => Boolean(value));
    if (query) return query;
  }
  return metadataFallbackQuery(url, "VK Music");
}

async function vkCollectionQueries(ownerId?: string, albumId?: string) {
  if (!ownerId || !albumId) return [];

  const data = await vkApiRequest<VkGetResponse<VkAudio[] | { items?: VkAudio[] }>>(
    "audio.get",
    {
      owner_id: ownerId,
      album_id: albumId,
      count: playlistLimit,
      offset: 0
    }
  );

  if (!data?.response) return [];

  const items = Array.isArray(data.response)
    ? data.response
    : data.response.items ?? [];

  const mapped = items
    .map(vkTrackItemQuery)
    .filter((q): q is string => Boolean(q));

  return uniqueQueries(mapped);
}

async function vkAudioById(ownerId: string, audioId: string) {
  const data = await vkApiRequest<VkGetResponse<VkAudio[]>>("audio.getById", {
    audios: `${ownerId}_${audioId}`
  });
  return data?.response ?? [];
}

async function vkApiRequest<T>(method: string, params: Record<string, string | number>) {
  if (!env.vkAccessToken) return undefined;

  const searchParams = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    access_token: env.vkAccessToken,
    v: "5.131"
  });

  const data = await fetchJson<T>(`https://api.vk.com/method/${method}?${searchParams.toString()}`);
  return data;
}

function extractYandexQueries(data: YandexResponse | undefined) {
  if (!data) return [];

  const tracks =
    data.playlist?.tracks ??
    data.album?.tracks ??
    data.tracks ??
    (data.track ? [data.track] : []);

  return tracks
    .map(yandexTrackItemQuery)
    .filter((q): q is string => Boolean(q));
}

function yandexTrackItemQuery(item: YandexTrackItem) {
  const track = item.track ?? item;

  const title = track.title?.trim();
  if (!title) return undefined;

  const artists =
    track.artists?.map((a: { name?: string }) => a.name?.trim()).filter(Boolean) ?? [];

  return trackQuery(title, artists);
}

function vkTrackItemQuery(item: VkAudio) {
  const title = item.title?.trim();
  if (!title) return undefined;

  const artistsRaw =
    item.artist?.trim()
      ? [item.artist.trim()]
      : item.performer?.trim()
        ? [item.performer.trim()]
        : item.artists?.map(a => a.name?.trim()).filter(Boolean) ?? [];

  const artists = artistsRaw.filter(Boolean) as string[];

  return trackQuery(title, artists);
}

async function loadSearchQueries(
  lavalink: LavalinkClient,
  queries: string[],
  loader: (lavalink: LavalinkClient, query: string) => Promise<LavalinkTrack[]>
) {
  const tracks: LavalinkTrack[] = [];
  const concurrency = 5;
  const unique = uniqueQueries(queries);

  for (let index = 0; index < unique.length; index += concurrency) {
    const chunk = unique.slice(index, index + concurrency);

    const results = await Promise.all(
      chunk.map(q => loader(lavalink, q).catch(() => []))
    );

    for (const result of results) {
      // 🔥 ВАЖНО: забираем ВСЕ треки, а не только [0]
      for (const track of result) {
        if (track) tracks.push(track);

        if (tracks.length >= playlistLimit) {
          return tracks;
        }
      }
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

async function fetchJson<T>(url: string, init: RequestInit = {}) {
  const response = await fetchWithTimeout(url, init);
  if (!response?.ok) return undefined;
  return (await response.json()) as T;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 NikoBox/1.0",
        Accept: "text/html,application/json",
        ...(init.headers ?? {})
      }
    });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function trackQuery(title: string, artists: Array<string | undefined>) {
  return [...artists, title].map((part) => part?.trim()).filter((part): part is string => Boolean(part)).join(" ");
}

function uniqueQueries(queries: string[]) {
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
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

function spotifyAlbumItemQuery(item: SpotifyTrackObject) {
  if (!item.name) return undefined;
  const artists = item.artists?.map((artist) => artist.name?.trim()).filter(Boolean) ?? [];
  return trackQuery(item.name, artists);
}

function spotifyPlaylistItemQuery(item: SpotifyPlaylistTrackItem) {
  const track = item.track;
  if (!track || track.is_local || !track.name) return undefined;
  const artists = track.artists?.map((artist) => artist.name?.trim()).filter(Boolean) ?? [];
  return trackQuery(track.name, artists);
}

interface SpotifyTrackObject {
  name?: string;
  artists?: Array<{ name?: string }>;
}

interface SpotifyPlaylistTrackItem {
  track?: SpotifyTrackObject & { is_local?: boolean };
}

interface SpotifyAlbumTracksResponse {
  items?: SpotifyTrackObject[];
  next?: string | null;
}

interface SpotifyPlaylistTracksResponse {
  items?: SpotifyPlaylistTrackItem[];
  next?: string | null;
}

interface YandexResponse {
  playlist?: { tracks?: YandexTrackItem[] };
  album?: { tracks?: YandexTrackItem[] };
  tracks?: YandexTrackItem[];
  track?: YandexTrackItem;
}

interface YandexTrackItem {
  track?: YandexTrackObject;
  title?: string;
  artists?: Array<{ name?: string }>;
}

interface YandexTrackObject {
  title?: string;
  artists?: Array<{ name?: string }>;
}

interface VkGetResponse<T> {
  response?: T;
}

interface VkAudio {
  title?: string;
  artist?: string;
  performer?: string;
  artists?: Array<{ name?: string }>;
}
