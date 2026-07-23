// Listening-data handlers (PR 2). Each one:
//   1. Reads clientConfig + tokens; returns a structured error
//      result if either is missing.
//   2. Calls `spotifyApi(...)` for the matching Spotify endpoint.
//   3. Normalises the response into the View-friendly shape.
//
// Kept separate from `index.ts` so the dispatcher stays small and
// each handler is independently testable. Pure delegation — the
// runtime + clientId + tokens are passed in by the dispatcher.

import { spotifyApi } from "./client";
import type { SpotifyClientResult } from "./client";
import { normalisePlaylist, normalisePlaylistList, normaliseRecentlyPlayed, normaliseTrack, normaliseTrackList } from "./normalize";
import type { NormalisedPlaylist, NormalisedTrack, RecentlyPlayedItem, SpotifyDeps } from "./types";

export async function fetchLiked(deps: SpotifyDeps, limit: number): Promise<SpotifyClientResult<NormalisedTrack[]>> {
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "GET", `/v1/me/tracks?limit=${limit}`, {}, deps.now);
  if (!result.ok) return result;
  return { ok: true, data: normaliseTrackList(result.data, "track") };
}

/** Spotify's `/v1/me/playlists` caps at 50 items per page. Walk
 *  pages until exhausted (`next === null`) or a hard cap is hit, so
 *  users with a large library don't silently lose playlists
 *  (CodeRabbit review on PR #1166). Cap at 500 so a runaway
 *  account-with-thousands-of-playlists doesn't blow the LLM context
 *  window or hammer the API. */
const PLAYLISTS_PAGE_SIZE = 50;
const PLAYLISTS_HARD_CAP = 500;

export async function fetchPlaylists(deps: SpotifyDeps): Promise<SpotifyClientResult<NormalisedPlaylist[]>> {
  const collected: NormalisedPlaylist[] = [];
  let offset = 0;
  while (collected.length < PLAYLISTS_HARD_CAP) {
    const result = await spotifyApi(
      deps.runtime,
      deps.clientId,
      deps.tokens,
      "GET",
      `/v1/me/playlists?limit=${PLAYLISTS_PAGE_SIZE}&offset=${offset}`,
      {},
      deps.now,
    );
    if (!result.ok) return result;
    logPlaylistsPageDebug(deps, result.data, offset);
    collected.push(...normalisePlaylistList(result.data));
    if (!hasNextPage(result.data)) break;
    offset += PLAYLISTS_PAGE_SIZE;
  }
  return { ok: true, data: collected };
}

function hasNextPage(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && typeof (raw as { next?: unknown }).next === "string";
}

function logPlaylistsPageDebug(deps: SpotifyDeps, raw: unknown, offset: number): void {
  // Dump first item's `tracks` shape on debug log so "all playlists
  // show 0 tracks" reports can be triaged from the server log
  // without re-running curl.
  if (typeof raw !== "object" || raw === null) return;
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return;
  if (typeof items[0] !== "object" || items[0] === null) return;
  const sample = items[0] as { id?: unknown; name?: unknown; tracks?: unknown };
  deps.runtime.log.debug("playlists page", { offset, count: items.length, sample: { id: sample.id, name: sample.name, tracks: sample.tracks } });
}

export async function fetchPlaylistTracks(deps: SpotifyDeps, playlistId: string, limit: number): Promise<SpotifyClientResult<NormalisedTrack[]>> {
  const path = `/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${limit}`;
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "GET", path, {}, deps.now);
  if (!result.ok) return result;
  return { ok: true, data: normaliseTrackList(result.data, "track") };
}

export async function fetchRecent(deps: SpotifyDeps, limit: number): Promise<SpotifyClientResult<RecentlyPlayedItem[]>> {
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "GET", `/v1/me/player/recently-played?limit=${limit}`, {}, deps.now);
  if (!result.ok) return result;
  return { ok: true, data: normaliseRecentlyPlayed(result.data) };
}

/** `nowPlaying` returns null when nothing is currently playing
 *  (Spotify returns 204). The View shows an empty state. */
export async function fetchNowPlaying(deps: SpotifyDeps): Promise<SpotifyClientResult<NormalisedTrack | null>> {
  const result = await spotifyApi<unknown>(deps.runtime, deps.clientId, deps.tokens, "GET", "/v1/me/player/currently-playing", {}, deps.now);
  if (!result.ok) return result;
  if (result.data === null) return { ok: true, data: null };
  // Currently-playing wraps the track under `item`. Some endpoints
  // (e.g. local playback) return null here even with a 200; the
  // normaliser handles that as a drop.
  if (typeof result.data === "object" && result.data !== null && "item" in result.data) {
    const track = normaliseTrack((result.data as { item: unknown }).item);
    return { ok: true, data: track };
  }
  // Anything else (ad break, podcast/show context, or a future
  // currently-playing-type the API adds) collapses to "nothing to
  // show" — the View renders the empty state. We deliberately don't
  // try alternative normalisers here; if a future PR adds a podcast
  // surface, it'll need its own handler.
  return { ok: true, data: null };
}

// `normalisePlaylist` is exported so the LLM can request a single
// playlist's metadata via `playlistTracks` indirectly; reserved for
// future kinds.
export { normalisePlaylist };
