/**
 * Minimal Spotify Web API client.
 *
 * Uses the Client Credentials flow (server-to-server, no user context) to fetch
 * track metadata for a single track, an album, or a playlist. This is the
 * reliable way to resolve Spotify links: the official API does not rate-limit
 * / captcha HTML scraping the way the public embed endpoint does, and it
 * paginates through full playlists (up to ~10k tracks) instead of capping at
 * the first ~50-100 rendered by the embed page.
 *
 * Requires SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (optional env vars).
 */

export interface SpotifyTrackQuery {
  title: string;
  artists: string[];
  /** Duration in milliseconds, when known — useful for accurate matching. */
  durationMs?: number;
}

/** Spotify resource types we can resolve into playable tracks. */
export type SpotifyType = "track" | "artist" | "album" | "playlist";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

interface CachedToken {
  value: string;
  /** Unix epoch (ms) at which the token expires. */
  expiresAt: number;
}

export class SpotifyClient {
  private token?: CachedToken;

  constructor(
    private readonly clientId?: string,
    private readonly clientSecret?: string
  ) {}

  /** True only when credentials are configured. */
  get isConfigured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  /**
   * Resolve a track, artist, album, or playlist into a list of search queries.
   * Returns `undefined` when credentials are missing or the request fails so
   * the caller can fall back to embed scraping.
   */
  async resolveQueries(type: SpotifyType, id: string): Promise<SpotifyTrackQuery[] | undefined> {
    if (!this.isConfigured) return undefined;
    try {
      const token = await this.ensureToken();
      if (!token) return undefined;

      if (type === "track") {
        const track = await this.get<SpotifyApiTrack>(`${API_BASE}/tracks/${id}`, token);
        return [toQuery(track)];
      }

      if (type === "artist") {
        // An artist link isn't a track list by itself — use the artist's top
        // tracks (a single request, market-restricted to a fixed market because
        // top-tracks are always returned for one market).
        const top = await this.get<{ tracks?: SpotifyApiTrack[] }>(
          `${API_BASE}/artists/${id}/top-tracks?market=US`,
          token
        );
        return (top.tracks ?? []).map(toQuery);
      }

      if (type === "album") {
        const queries = await this.collectAll(
          `${API_BASE}/albums/${id}/tracks?limit=50`,
          token,
          (page) => (page.items as SpotifyApiAlbumTrack[]).map(toQuery)
        );
        return queries;
      }

      // playlist
      const queries = await this.collectAll(
        `${API_BASE}/playlists/${id}/tracks?limit=100&additional_types=track`,
        token,
        (page) =>
          (page.items as Array<{ track?: SpotifyApiTrack }>)
            .map((item) => (item?.track ? toQuery(item.track) : undefined))
            .filter((value): value is SpotifyTrackQuery => Boolean(value))
      );
      return queries;
    } catch (error) {
      console.warn("[SPOTIFY API] resolveQueries failed:", error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  private async ensureToken(): Promise<string | undefined> {
    // Refresh a little early to avoid using a token that expires mid-request.
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }
    return this.refreshToken();
  }

  private async refreshToken(): Promise<string | undefined> {
    if (!this.clientId || !this.clientSecret) return undefined;

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const body = new URLSearchParams({ grant_type: "client_credentials" });

    const response = await fetchWithTimeout(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    if (!response?.ok) {
      console.warn(`[SPOTIFY API] token request failed: HTTP ${response?.status ?? "no-response"}`);
      return undefined;
    }

    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      console.warn("[SPOTIFY API] token response had no access_token");
      return undefined;
    }

    const expiresIn = Number(data.expires_in ?? 3600);
    this.token = { value: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return this.token.value;
  }

  /**
   * Walk paginated Spotify collections (`next` URL chain) and flatten the items
   * into queries using the supplied mapper.
   */
  private async collectAll(
    startUrl: string,
    token: string,
    mapItems: (page: SpotifyApiPage) => SpotifyTrackQuery[]
  ): Promise<SpotifyTrackQuery[]> {
    const queries: SpotifyTrackQuery[] = [];
    let url: string | null | undefined = startUrl;
    let safety = 0;

    while (url && safety < 200) {
      safety++;
      const page: SpotifyApiPage = await this.get<SpotifyApiPage>(url, token);
      queries.push(...mapItems(page));
      url = page.next;
    }

    return queries;
  }

  private async get<T>(url: string, token: string): Promise<T> {
    const response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    if (!response?.ok) throw new Error(`Spotify API ${response?.status ?? "no-response"}`);
    return (await response.json()) as T;
  }
}

interface SpotifyApiPage {
  items: unknown[];
  next?: string | null;
}

interface SpotifyApiArtist {
  name?: string;
}

interface SpotifyApiTrack {
  name?: string;
  artists?: SpotifyApiArtist[];
  duration_ms?: number;
}

interface SpotifyApiAlbumTrack {
  name?: string;
  artists?: SpotifyApiArtist[];
  duration_ms?: number;
}

function toQuery(track: SpotifyApiTrack | SpotifyApiAlbumTrack): SpotifyTrackQuery {
  const artists = (track.artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter((value): value is string => Boolean(value));
  const durationMs = typeof track.duration_ms === "number" ? track.duration_ms : undefined;
  return { title: track.name?.trim() ?? "", artists, durationMs };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 NikoBox/1.0",
        ...(init.headers ?? {})
      }
    });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
