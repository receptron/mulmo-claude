// Search handler — wraps Spotify's `/v1/search` and normalises the
// per-category response into the View-friendly shape. Public API:
// LLM and View both call into this via the `search` dispatch kind.
//
// Result shape: only the categories the caller asked for are
// present in the returned `SearchResult`. That keeps the LLM
// context window tight (no empty `tracks: []` stub when the caller
// only wanted artists).

import { spotifyApi } from "./client";
import type { SpotifyClientResult } from "./client";
import { normaliseAlbumList, normaliseArtistList, normalisePlaylistList, normaliseTrackList } from "./normalize";
import type { SearchResult, SpotifyDeps } from "./types";

export type SearchType = "track" | "artist" | "album" | "playlist";

const DEFAULT_SEARCH_TYPES: readonly SearchType[] = ["track", "artist", "album", "playlist"];
const DEFAULT_SEARCH_LIMIT = 10;

export async function searchSpotify(
  deps: SpotifyDeps,
  query: string,
  types: readonly SearchType[] | undefined,
  limit: number | undefined,
): Promise<SpotifyClientResult<SearchResult>> {
  const requested = types && types.length > 0 ? types : DEFAULT_SEARCH_TYPES;
  const cap = limit ?? DEFAULT_SEARCH_LIMIT;
  const url = buildSearchUrl(query, requested, cap);
  const response = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "GET", url, {}, deps.now);
  if (!response.ok) return response;
  return { ok: true, data: assembleSearchResult(response.data, requested) };
}

function buildSearchUrl(query: string, types: readonly SearchType[], limit: number): string {
  // Spotify accepts `type=track,artist,…` as a CSV. URLSearchParams
  // would percent-encode the comma, which Spotify still accepts but
  // makes the URL noisier in logs.
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return `/v1/search?${params.toString()}&type=${types.join(",")}`;
}

function assembleSearchResult(raw: unknown, requested: readonly SearchType[]): SearchResult {
  if (typeof raw !== "object" || raw === null) return {};
  const root = raw as { tracks?: unknown; artists?: unknown; albums?: unknown; playlists?: unknown };
  const out: SearchResult = {};
  if (requested.includes("track")) out.tracks = normaliseTrackList(root.tracks, "self");
  if (requested.includes("artist")) out.artists = normaliseArtistList(root.artists);
  if (requested.includes("album")) out.albums = normaliseAlbumList(root.albums);
  if (requested.includes("playlist")) out.playlists = normalisePlaylistList(root.playlists);
  return out;
}
