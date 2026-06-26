import type { LavalinkClient, LavalinkTrack } from "../lavalink/LavalinkClient.js";
import type { TrackSource } from "@nikobox/shared";

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

export async function resolveInput(lavalink: LavalinkClient, input: string): Promise<ResolvedInput> {
  const trimmed = input.trim();

  const spotify = parseSpotifyUrl(trimmed);
  if (spotify) {
    return resolveSpotifyInput(lavalink, trimmed, spotify.type, spotify.id);
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

  const queries = await spotifyEmbedQueries(type, id);

  if (queries.length === 1 && type === "track") {
    return {
      tracks: await loadSearchQueries(lavalink, queries, loadMetadataSearch),
      source: "spotify",
      isPlaylist: false,
      notice: "Spotify track resolved via embed"
    };
  }

  if (queries.length > 0) {
    return {
      tracks: await loadSearchQueries(
        lavalink,
        queries.slice(0, playlistLimit),
        loadMetadataSearch
      ),
      source: "spotify",
      isPlaylist: true,
      notice: `Spotify ${type} resolved (${queries.length} items via embed)`
    };
  }

  // Last-resort fallback: resolve as a single track via page metadata.
  const fallback = await metadataFallbackQuery(url, "Spotify");

  return {
    tracks: await loadSearchQueries(lavalink, [fallback], loadMetadataSearch),
    source: "spotify",
    isPlaylist: false,
    notice: "Spotify fallback used"
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
    .replace(/\b(open|com|ru|music|album|playlist|playlists|track|tracks|users|spotify|audio|audios)\b/gi, "")
    .trim();
  return readable ? `${readable} audio` : `${service} track audio`;
}

function parseSpotifyUrl(url: string) {
  const match = spotifyUrlRegex.exec(url);
  if (!match) return undefined;
  return { type: match[1] as "track" | "album" | "playlist", id: match[2] };
}

/**
 * Resolve Spotify tracks/album/playlist via the public embed endpoint.
 *
 * `https://open.spotify.com/embed/{type}/{id}` returns a Next.js page whose
 * `__NEXT_DATA__` script contains the track list under
 * `props.pageProps.state.data.entity`. This works without any credentials:
 *  - playlist/album -> `entity.trackList[]` ({ title, subtitle, uri })
 *  - track          -> `entity` ({ title, artists[] })
 *
 * Returns an array of "artist title" search queries suitable for metadata search.
 */
async function spotifyEmbedQueries(type: "track" | "album" | "playlist", id: string): Promise<string[]> {
  try {
    const response = await fetchWithTimeout(
      `https://open.spotify.com/embed/${type}/${encodeURIComponent(id)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "text/html"
        }
      }
    );
    if (!response?.ok) return [];

    const html = await response.text();
    const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!match) return [];

    const data = JSON.parse(match[1]) as SpotifyEmbedResponse;
    const entity = data?.props?.pageProps?.state?.data?.entity;
    if (!entity) return [];

    const queries: string[] = [];

    // Playlist / album: track list with title + subtitle ("Artist, Artist").
    if (Array.isArray(entity.trackList)) {
      for (const item of entity.trackList) {
        const title = item.title?.trim();
        const subtitle = item.subtitle?.trim();
        if (!title) continue;
        const artists = subtitle ? subtitle.split(/[,;&]|(?:\s+feat\.?\s+)/i).map(s => s.trim()).filter(Boolean) : [];
        queries.push(trackQuery(title, artists));
      }
      return uniqueQueries(queries);
    }

    // Single track: title + artists[].
    const title = entity.title?.trim();
    if (title) {
      const artists = (entity.artists ?? [])
        .map(artist => artist.name?.trim())
        .filter((value): value is string => Boolean(value));
      queries.push(trackQuery(title, artists));
    }

    return uniqueQueries(queries);
  } catch {
    return [];
  }
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

interface SpotifyEmbedResponse {
  props?: {
    pageProps?: {
      state?: {
        data?: {
          entity?: SpotifyEmbedEntity;
        };
      };
    };
  };
}

interface SpotifyEmbedEntity {
  type?: string;
  name?: string;
  title?: string;
  uri?: string;
  // Playlist / album track list.
  trackList?: SpotifyEmbedTrack[];
  // Single track artist list.
  artists?: Array<{ name?: string }>;
}

interface SpotifyEmbedTrack {
  title?: string;
  subtitle?: string;
  uri?: string;
}
