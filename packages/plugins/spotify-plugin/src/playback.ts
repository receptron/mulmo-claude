// Player Controls (PR 3). Handlers for the 8 dispatch kinds added
// in PR 3. Spotify Premium is required at runtime — the dispatcher
// in `index.ts` checks `getProfile()` before calling any of these
// (except `getDevices`, which is read-only and works for Free
// accounts too — useful for the View's device dropdown even before
// upgrade).
//
// Spotify's Player API is mostly side-effects: `play`, `pause`,
// `next`, etc. all return 204 on success. The handlers below
// translate the (mostly-empty) response into a friendly
// `{ ok, message }` so the LLM can confirm the action. `getDevices`
// is the only one with an interesting payload.

import { spotifyApi } from "./client";
import type { SpotifyClientResult } from "./client";
import type { NormalisedDevice, SpotifyDeps } from "./types";

interface PlayArgs {
  deviceId?: string;
  contextUri?: string;
  trackUris?: string[];
}

export async function playerPlay(deps: SpotifyDeps, args: PlayArgs): Promise<SpotifyClientResult<null>> {
  const body: Record<string, unknown> = {};
  if (args.contextUri) body.context_uri = args.contextUri;
  if (args.trackUris) body.uris = args.trackUris;
  const path = withDeviceId("/v1/me/player/play", args.deviceId);
  // Spotify's `play` accepts PUT with empty body (resume) or with
  // {context_uri, uris, offset, position_ms} (start specific
  // content). Pass an empty body when no `contextUri`/`trackUris`
  // were supplied — that's the "resume" semantics.
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "PUT", path, Object.keys(body).length > 0 ? { body } : {}, deps.now);
  return mapVoidResult(result);
}

export async function playerPause(deps: SpotifyDeps, deviceId?: string): Promise<SpotifyClientResult<null>> {
  const path = withDeviceId("/v1/me/player/pause", deviceId);
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "PUT", path, {}, deps.now);
  return mapVoidResult(result);
}

export async function playerNext(deps: SpotifyDeps, deviceId?: string): Promise<SpotifyClientResult<null>> {
  const path = withDeviceId("/v1/me/player/next", deviceId);
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "POST", path, {}, deps.now);
  return mapVoidResult(result);
}

export async function playerPrevious(deps: SpotifyDeps, deviceId?: string): Promise<SpotifyClientResult<null>> {
  const path = withDeviceId("/v1/me/player/previous", deviceId);
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "POST", path, {}, deps.now);
  return mapVoidResult(result);
}

/** PUT a Player endpoint whose only query is one required param plus an
 *  optional `device_id` (seek, volume). */
async function playerPutWithParam(deps: SpotifyDeps, basePath: string, param: Record<string, string>, deviceId?: string): Promise<SpotifyClientResult<null>> {
  const params = new URLSearchParams(param);
  const path = appendQueryParam(`${basePath}?${params.toString()}`, "device_id", deviceId);
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "PUT", path, {}, deps.now);
  return mapVoidResult(result);
}

export async function playerSeek(deps: SpotifyDeps, positionMs: number, deviceId?: string): Promise<SpotifyClientResult<null>> {
  return playerPutWithParam(deps, "/v1/me/player/seek", { position_ms: String(positionMs) }, deviceId);
}

export async function playerSetVolume(deps: SpotifyDeps, volumePercent: number, deviceId?: string): Promise<SpotifyClientResult<null>> {
  return playerPutWithParam(deps, "/v1/me/player/volume", { volume_percent: String(volumePercent) }, deviceId);
}

export async function playerTransfer(deps: SpotifyDeps, deviceId: string, play: boolean | undefined): Promise<SpotifyClientResult<null>> {
  const body: Record<string, unknown> = { device_ids: [deviceId] };
  if (play !== undefined) body.play = play;
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "PUT", "/v1/me/player", { body }, deps.now);
  return mapVoidResult(result);
}

export async function playerGetDevices(deps: SpotifyDeps): Promise<SpotifyClientResult<NormalisedDevice[]>> {
  const result = await spotifyApi<unknown>(deps.runtime, deps.clientId, deps.tokens, "GET", "/v1/me/player/devices", {}, deps.now);
  if (!result.ok) return result;
  return { ok: true, data: normaliseDevices(result.data) };
}

function withDeviceId(basePath: string, deviceId: string | undefined): string {
  if (!deviceId) return basePath;
  return `${basePath}?${new URLSearchParams({ device_id: deviceId }).toString()}`;
}

function appendQueryParam(path: string, key: string, value: string | undefined): string {
  if (!value) return path;
  return `${path}&${new URLSearchParams({ [key]: value }).toString()}`;
}

/** Player API success responses are 204 No Content; `data` is null
 *  in our client wrapper. Normalise so the dispatcher can use a
 *  uniform `{ ok, message }` shape. */
function mapVoidResult(result: SpotifyClientResult<unknown>): SpotifyClientResult<null> {
  if (!result.ok) return result;
  return { ok: true, data: null };
}

interface RawDevice {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  is_active?: unknown;
  volume_percent?: unknown;
}

function normaliseDevices(raw: unknown): NormalisedDevice[] {
  if (typeof raw !== "object" || raw === null) return [];
  const devices = (raw as { devices?: unknown }).devices;
  if (!Array.isArray(devices)) return [];
  const out: NormalisedDevice[] = [];
  for (const candidate of devices) {
    const normalised = normaliseDevice(candidate);
    if (normalised) out.push(normalised);
  }
  return out;
}

function normaliseDevice(raw: unknown): NormalisedDevice | null {
  if (typeof raw !== "object" || raw === null) return null;
  const device = raw as RawDevice;
  // Spotify can return restricted devices with a `name` + `type`
  // but no `id` (DRM / account-state quirks). Preserve them — the
  // View renders them with the Transfer button disabled — so the
  // user isn't left wondering "why isn't my speaker listed?"
  // (Codex review on PR #1171). `name` is still required: an
  // anonymous nameless device is not useful to surface.
  if (typeof device.name !== "string") return null;
  const id = typeof device.id === "string" && device.id.length > 0 ? device.id : null;
  const volumePercent = typeof device.volume_percent === "number" && Number.isFinite(device.volume_percent) ? device.volume_percent : undefined;
  return {
    id,
    name: device.name,
    type: typeof device.type === "string" ? device.type : "",
    isActive: device.is_active === true,
    ...(volumePercent !== undefined ? { volumePercent } : {}),
  };
}
