// Spotify plugin — server side (issue #1162).
//
// PR 1 ships only the OAuth-flavored kinds:
//   - `connect`        — generate authorize URL + register PKCE pending auth
//   - `oauthCallback`  — invoked by the host's generic OAuth callback
//                        endpoint after Spotify redirects the browser back;
//                        validates state, exchanges code for tokens, persists
//   - `status`         — connection state for the View (no token values)
//   - `diagnose`       — verbose diagnostic for the LLM to surface to the
//                        user when something is misconfigured
//
// PR 2 extends the dispatch union with the listening-data kinds
// (`liked` / `playlists` / `playlistTracks` / `recent` / `nowPlaying`)
// and ships a Vue View / Preview.
//
// Everything that touches disk goes through `runtime.files.config`
// (per-machine secret), every external HTTP call uses `runtime.fetch`
// with an explicit `allowedHosts` allowlist. The eslint preset bans
// `node:fs` / `node:path` / direct `fetch` so platform bypasses
// surface at lint time.

import { definePlugin, type PluginRuntime } from "gui-chat-protocol";
import { escapeHtml } from "@mulmoclaude/common";

import { TOOL_DEFINITION } from "./definition";
import { DispatchArgsSchema, type DispatchArgs } from "./schemas";
import { buildAuthorizeUrl, consumePendingAuthorization, deriveCodeChallenge, generateRandomToken, registerPendingAuthorization } from "./oauth";
import { readClientConfig, readTokens, writeClientConfig, writeTokens } from "./tokens";
import { ONE_SECOND_MS } from "./time";
import type { NormalisedDevice, NormalisedPlaylist, NormalisedTrack, SpotifyClientConfig, SpotifyTokens } from "./types";
import { fetchLiked, fetchNowPlaying, fetchPlaylistTracks, fetchPlaylists, fetchRecent } from "./listening";
import { searchSpotify } from "./search";
import { summariseSearch } from "./searchSummary";
import { clearProfileCache, getProfile, isPremium } from "./profile";
import { playerGetDevices, playerNext, playerPause, playerPlay, playerPrevious, playerSeek, playerSetVolume, playerTransfer } from "./playback";
import type { SpotifyClientError } from "./client";

export { TOOL_DEFINITION };

// Short, URL-safe alias the host registers as
// `/api/plugins/runtime/oauth-callback/:alias`. Spotify's Dashboard
// rejects redirect URIs that contain percent-encoded path characters
// (the natural shape when `:pkg` is `@mulmoclaude/spotify-plugin`), so
// each OAuth-using runtime plugin declares its own alphanumeric alias.
// Collisions with other plugins are detected at boot and surfaced as
// startup diagnostics.
export const OAUTH_CALLBACK_ALIAS = "spotify";

/** Scope set requested at OAuth time. Two extra scopes were added
 *  in PR 3 for Player Controls: `user-read-playback-state` (read
 *  active device + playback state) and `user-modify-playback-state`
 *  (play/pause/next/seek/volume/transfer). Existing users from
 *  PR 1/2 will hit `403 Insufficient client scope` on the new
 *  player kinds and need to reconnect. */
const SPOTIFY_SCOPES: readonly string[] = [
  "playlist-read-private",
  "user-library-read",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-recently-played",
] as const;

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_TOKEN_HOST = "accounts.spotify.com";

const TOKEN_EXCHANGE_TIMEOUT_MS = 15 * ONE_SECOND_MS;

const CLIENT_ID_MISSING_INSTRUCTIONS = [
  "Spotify の Client ID が未設定です。",
  "",
  "1. https://developer.spotify.com/dashboard を開いて Spotify アカウントでログイン",
  "2. 「Create app」 → Redirect URIs に http://127.0.0.1:<PORT>/api/plugins/runtime/oauth-callback/spotify を追加 (PORT は mulmoclaude が動いているポート)",
  "3. Web API をチェックして保存",
  "4. Client ID をコピー",
  "5. plugin View の「Configure」で貼り付ける",
  "",
  "詳細: docs/tips/spotify-setup.md",
].join("\n");

interface RawTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

export default definePlugin((pluginRuntime) => {
  const { files, log, fetch: runtimeFetch, pubsub } = pluginRuntime;
  return {
    TOOL_DEFINITION,

    async manageSpotify(rawArgs: unknown) {
      const parsed = DispatchArgsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return {
          ok: false,
          error: "invalid_args",
          message: `Invalid arguments: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        };
      }
      const args: DispatchArgs = parsed.data;
      switch (args.kind) {
        case "connect":
          return handleConnect(args.redirectUri);
        case "oauthCallback":
          return handleOauthCallback({ code: args.code, state: args.state, error: args.error });
        case "status":
          return handleStatus();
        case "diagnose":
          return handleDiagnose();
        case "configure":
          return handleConfigure({ clientId: args.clientId });
        case "liked":
          return handleListening("liked", args);
        case "playlists":
          return handleListening("playlists", args);
        case "playlistTracks":
          return handleListening("playlistTracks", args);
        case "recent":
          return handleListening("recent", args);
        case "nowPlaying":
          return handleListening("nowPlaying", args);
        case "search":
          return handleSearch(args);
        case "play":
        case "pause":
        case "next":
        case "previous":
        case "seek":
        case "setVolume":
        case "transferPlayback":
        case "getDevices":
          return handlePlayer(args);
        default: {
          const exhaustive: never = args;
          throw new Error(`Unhandled kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };

  // ───────────────────────────────────────────────────────────
  // Handlers (closures over runtime)
  // ───────────────────────────────────────────────────────────

  async function handleConnect(redirectUri: string) {
    const clientConfig = await readClientConfig(files.config);
    if (!clientConfig) {
      return {
        ok: false,
        error: "client_id_missing",
        message: "Spotify Client ID が未設定です。詳細は instructions を参照してください。",
        instructions: CLIENT_ID_MISSING_INSTRUCTIONS,
      };
    }
    const codeVerifier = generateRandomToken();
    const codeChallenge = await deriveCodeChallenge(codeVerifier);
    const state = registerPendingAuthorization(codeVerifier, redirectUri);
    const authorizeUrl = buildAuthorizeUrl({
      clientId: clientConfig.clientId,
      redirectUri,
      scopes: SPOTIFY_SCOPES,
      state,
      codeChallenge,
    });
    return {
      ok: true,
      message: "Spotify の同意画面の URL を生成しました。ブラウザで開いてください。",
      data: { authorizeUrl },
    };
  }

  async function handleOauthCallback(input: { code?: string; state?: string; error?: string }) {
    if (input.error) {
      log.info("user denied authorization", { error: input.error });
      return {
        ok: false,
        error: "auth_denied",
        message: `Spotify からの認可が拒否されました: ${input.error}`,
        html: renderCallbackHtml({ title: "Spotify authorization denied", body: `Spotify returned: ${input.error}` }),
      };
    }
    if (!input.code || !input.state) {
      return {
        ok: false,
        error: "invalid_callback",
        message: "Callback request was missing `code` or `state`.",
        html: renderCallbackHtml({ title: "Invalid callback", body: "Missing `code` or `state` query parameter." }),
      };
    }
    const pending = consumePendingAuthorization(input.state);
    if (!pending) {
      return {
        ok: false,
        error: "unknown_state",
        message: "この認可リクエストは mulmoclaude から開始されたものではない、または期限切れです。",
        instructions: "plugin View の「Connect」を再度押してください。",
        html: renderCallbackHtml({
          title: "Unknown state",
          body: "This authorization request was not initiated by mulmoclaude (or it expired). Please retry from the plugin View.",
        }),
      };
    }
    const clientConfig = await readClientConfig(files.config);
    if (!clientConfig) {
      return {
        ok: false,
        error: "client_id_missing",
        message: "Spotify Client ID が未設定です。",
        instructions: CLIENT_ID_MISSING_INSTRUCTIONS,
        html: renderCallbackHtml({ title: "Spotify client ID not configured", body: CLIENT_ID_MISSING_INSTRUCTIONS }),
      };
    }
    try {
      const tokens = await exchangeCodeForTokens({
        code: input.code,
        clientId: clientConfig.clientId,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUri,
      });
      await writeTokens(files.config, tokens);
      // Invalidate the profile cache: a fresh Connect may be a
      // different Spotify account, so the previous user's `product`
      // must not leak through the 24h TTL (Codex review on PR
      // #1171). The next `getProfile` call will fetch the new
      // user's snapshot.
      await clearProfileCache(files.config);
      pubsub.publish("connected", { scopes: tokens.scopes });
      log.info("tokens written", { scopes: tokens.scopes });
      return {
        ok: true,
        message: "Spotify を接続しました。",
        html: renderCallbackHtml({ title: "Spotify connected", body: "You can close this window and return to mulmoclaude." }),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.error("token exchange failed", { error: detail });
      const instructions = `Token exchange failed: ${detail}\n\nThis usually means the Redirect URI registered in your Spotify Developer Dashboard does not match the URL mulmoclaude is using:\n${pending.redirectUri}`;
      return {
        ok: false,
        error: "token_exchange_failed",
        message: detail,
        instructions,
        html: renderCallbackHtml({ title: "Token exchange failed", body: instructions }),
      };
    }
  }

  async function handleStatus() {
    const clientConfig = await readClientConfig(files.config);
    const tokens = await readTokens(files.config);
    let premium: boolean | null = null;
    let displayName = "";
    // Only call /v1/me when we have tokens — otherwise there's
    // nothing to authenticate with. Cache hit is the common case
    // (24h TTL) so most `status` calls don't go to Spotify.
    if (tokens && clientConfig) {
      const profileResult = await getProfile({ runtime: pluginRuntime, clientId: clientConfig.clientId, tokens });
      if (profileResult.ok) {
        premium = isPremium(profileResult.profile);
        displayName = profileResult.profile.displayName;
      }
    }
    return {
      ok: true,
      message: tokens ? "Connected." : clientConfig ? "Client ID is configured but you haven't connected yet." : "Client ID is not configured.",
      data: {
        clientIdConfigured: clientConfig !== null,
        connected: tokens !== null,
        expiresAt: tokens?.expiresAt ?? null,
        scopes: tokens?.scopes ?? [],
        // PR 3 — null when we couldn't determine (no tokens, or
        // /v1/me failed). View renders the player gate accordingly.
        isPremium: premium,
        displayName,
      },
    };
  }

  async function handleDiagnose() {
    const clientConfig = await readClientConfig(files.config);
    const tokens = await readTokens(files.config);
    return {
      ok: true,
      message: "See `data` for the connection diagnostics.",
      data: {
        clientIdConfigured: clientConfig !== null,
        tokensPresent: tokens !== null,
        expiresAt: tokens?.expiresAt ?? null,
        scopes: tokens?.scopes ?? [],
        // Never return the actual token / client_id values — diagnose
        // is meant for the LLM to read aloud.
      },
    };
  }

  async function exchangeCodeForTokens(params: { code: string; clientId: string; codeVerifier: string; redirectUri: string }): Promise<SpotifyTokens> {
    const response = await runtimeFetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
        client_id: params.clientId,
        code_verifier: params.codeVerifier,
      }).toString(),
      timeoutMs: TOKEN_EXCHANGE_TIMEOUT_MS,
      allowedHosts: [SPOTIFY_TOKEN_HOST],
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Spotify token endpoint returned ${response.status}: ${body.slice(0, 300)}`);
    }
    const raw = (await response.json()) as RawTokenResponse;
    if (typeof raw.access_token !== "string" || raw.access_token.length === 0) {
      throw new Error("Spotify response missing access_token");
    }
    if (typeof raw.refresh_token !== "string" || raw.refresh_token.length === 0) {
      throw new Error("Spotify response missing refresh_token");
    }
    if (typeof raw.expires_in !== "number" || !Number.isFinite(raw.expires_in)) {
      throw new Error("Spotify response missing expires_in");
    }
    return {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      expiresAt: new Date(Date.now() + raw.expires_in * ONE_SECOND_MS).toISOString(),
      scopes: typeof raw.scope === "string" ? raw.scope.split(" ").filter(Boolean) : [...SPOTIFY_SCOPES],
    };
  }

  async function handleConfigure(args: { clientId: string }) {
    const trimmed = args.clientId.trim();
    // Schema guarantees `min(1)` on the input, but trimming can
    // collapse whitespace-only strings to length 0 (CodeRabbit
    // review on PR #1166). Reject so we never persist a useless
    // Client ID that would silently break OAuth on the next
    // `connect` attempt.
    if (trimmed.length === 0) {
      return {
        ok: false,
        error: "invalid_client_id",
        message: "Client ID が空です。Spotify Developer Dashboard からコピーした文字列を貼り付けてください。",
      };
    }
    const config: SpotifyClientConfig = { clientId: trimmed };
    await writeClientConfig(files.config, config);
    log.info("client id configured");
    return { ok: true, message: "Spotify Client ID を保存しました。" };
  }

  async function handleListening(
    kind: "liked" | "playlists" | "playlistTracks" | "recent" | "nowPlaying",
    args: Extract<DispatchArgs, { kind: "liked" | "playlists" | "playlistTracks" | "recent" | "nowPlaying" }>,
  ) {
    const ready = await loadCredentials();
    if (!ready.ok) return ready.errorResponse;
    const deps = { runtime: pluginRuntime, clientId: ready.clientConfig.clientId, tokens: ready.tokens };
    const result = await invokeListening(kind, args, deps);
    if (!result.ok) return mapClientError(result.error);
    // The host MCP bridge passes ONLY `message` + `instructions` back
    // to the LLM (`data` is rendered in the View). For read kinds the
    // LLM needs the actual list of tracks / playlists to reason
    // about, so we mirror the listing into `message` as a compact
    // text format. Format mirrors what a human would write on a chat
    // thread; not designed for machine round-tripping (the View has
    // the structured `data`).
    return { ok: true, message: summariseListening(kind, result.data), data: result.data };
  }

  async function handleSearch(args: Extract<DispatchArgs, { kind: "search" }>) {
    const ready = await loadCredentials();
    if (!ready.ok) return ready.errorResponse;
    const deps = { runtime: pluginRuntime, clientId: ready.clientConfig.clientId, tokens: ready.tokens };
    const result = await searchSpotify(deps, args.query, args.types, args.limit);
    if (!result.ok) return mapClientError(result.error);
    return { ok: true, message: summariseSearch(args.query, result.data), data: result.data };
  }

  async function handlePlayer(args: Extract<DispatchArgs, { kind: PlayerKind }>) {
    // Spotify's `/v1/me/player/play` 400s if a body carries both
    // `context_uri` and `uris[]`. Catching this here (since we
    // can't .refine() inside a discriminatedUnion arm) gives a
    // clean error instead of a confusing 4xx from Spotify.
    if (args.kind === "play" && args.contextUri && args.trackUris) {
      return {
        ok: false,
        error: "invalid_args",
        message: "play: `contextUri` と `trackUris` は同時に指定できません。どちらか一方を選んでください。",
      };
    }
    const ready = await loadCredentials();
    if (!ready.ok) return ready.errorResponse;
    const deps = { runtime: pluginRuntime, clientId: ready.clientConfig.clientId, tokens: ready.tokens };
    // `getDevices` is read-only and works for Free accounts (the View
    // uses it to populate a dropdown even before upgrade). All other
    // player kinds require Premium; gate them up front so we don't
    // burn a wasted Spotify API call for a 403 we can predict.
    if (args.kind !== "getDevices") {
      const gate = await premiumGate(deps);
      if (gate) return gate;
    }
    const result = await invokePlayer(args, deps);
    if (!result.ok) return mapPlayerError(result.error, args.kind);
    return summarisePlayerResult(args.kind, result.data);
  }

  async function loadCredentials(): Promise<
    | { ok: true; clientConfig: SpotifyClientConfig; tokens: SpotifyTokens }
    | { ok: false; errorResponse: { ok: false; error: string; message: string; instructions?: string } }
  > {
    const clientConfig = await readClientConfig(files.config);
    if (!clientConfig) {
      return {
        ok: false,
        errorResponse: {
          ok: false,
          error: "client_id_missing",
          message: "Spotify Client ID が未設定です。",
          instructions: CLIENT_ID_MISSING_INSTRUCTIONS,
        },
      };
    }
    const tokens = await readTokens(files.config);
    if (!tokens) {
      return {
        ok: false,
        errorResponse: {
          ok: false,
          error: "not_connected",
          message: "Spotify に未接続です。「Connect」を実行してください。",
        },
      };
    }
    return { ok: true, clientConfig, tokens };
  }
});

type PlayerKind = "play" | "pause" | "next" | "previous" | "seek" | "setVolume" | "transferPlayback" | "getDevices";

async function invokePlayer(args: Extract<DispatchArgs, { kind: PlayerKind }>, deps: { runtime: PluginRuntime; clientId: string; tokens: SpotifyTokens }) {
  switch (args.kind) {
    case "play":
      return playerPlay(deps, { deviceId: args.deviceId, contextUri: args.contextUri, trackUris: args.trackUris });
    case "pause":
      return playerPause(deps, args.deviceId);
    case "next":
      return playerNext(deps, args.deviceId);
    case "previous":
      return playerPrevious(deps, args.deviceId);
    case "seek":
      return playerSeek(deps, args.positionMs, args.deviceId);
    case "setVolume":
      return playerSetVolume(deps, args.volumePercent, args.deviceId);
    case "transferPlayback":
      return playerTransfer(deps, args.deviceId, args.play);
    case "getDevices":
      return playerGetDevices(deps);
  }
}

async function invokeListening(
  kind: "liked" | "playlists" | "playlistTracks" | "recent" | "nowPlaying",
  args: Extract<DispatchArgs, { kind: "liked" | "playlists" | "playlistTracks" | "recent" | "nowPlaying" }>,
  deps: { runtime: PluginRuntime; clientId: string; tokens: SpotifyTokens },
) {
  switch (kind) {
    case "liked":
      return fetchLiked(deps, args.kind === "liked" ? (args.limit ?? 50) : 50);
    case "playlists":
      return fetchPlaylists(deps);
    case "playlistTracks":
      if (args.kind !== "playlistTracks") throw new Error("kind/args mismatch");
      return fetchPlaylistTracks(deps, args.playlistId, args.limit ?? 100);
    case "recent":
      return fetchRecent(deps, args.kind === "recent" ? (args.limit ?? 50) : 50);
    case "nowPlaying":
      return fetchNowPlaying(deps);
  }
}

/** Build the LLM-facing message string for a listening result.
 *  The plain text mirrors the View's grid: title + artists, one per
 *  line. Length-capped per kind so the LLM context window doesn't
 *  blow up on a 50-track Liked Songs response. */
function summariseListening(kind: "liked" | "playlists" | "playlistTracks" | "recent" | "nowPlaying", data: unknown): string {
  if (kind === "nowPlaying") {
    if (!data || typeof data !== "object" || !("name" in data)) return "Nothing is currently playing.";
    const track = data as { name: string; artists: string[]; album: string };
    return `Now playing: ${track.name} — ${track.artists.join(", ")} (${track.album})`;
  }
  if (!Array.isArray(data) || data.length === 0) return `No ${kind} items.`;
  if (kind === "playlists") {
    const lines = (data as { name: string; trackCount: number }[]).map((p, i) => `${i + 1}. ${p.name} (${p.trackCount} tracks)`);
    return `Playlists (${data.length}):\n${lines.join("\n")}`;
  }
  if (kind === "recent") {
    const lines = (data as { track: { name: string; artists: string[] }; playedAt: string }[]).map((item, i) => {
      const when = item.playedAt ? new Date(item.playedAt).toISOString().slice(0, 16).replace("T", " ") : "?";
      return `${i + 1}. [${when}] ${item.track.name} — ${item.track.artists.join(", ")}`;
    });
    return `Recently played (${data.length}):\n${lines.join("\n")}`;
  }
  // liked / playlistTracks share the NormalisedTrack[] shape.
  const lines = (data as { name: string; artists: string[] }[]).map((t, i) => `${i + 1}. ${t.name} — ${t.artists.join(", ")}`);
  const title = kind === "liked" ? "Liked Songs" : "Playlist tracks";
  return `${title} (${data.length}):\n${lines.join("\n")}`;
}

async function premiumGate(deps: {
  runtime: PluginRuntime;
  clientId: string;
  tokens: SpotifyTokens;
}): Promise<{ ok: false; error: string; message: string; instructions?: string } | null> {
  const profileResult = await getProfile(deps);
  if (!profileResult.ok) return mapClientError(profileResult.error);
  if (isPremium(profileResult.profile)) return null;
  return {
    ok: false,
    error: "premium_required",
    message: "Spotify Premium が必要な操作です。Free アカウントでは再生制御は使えません。",
    instructions: "Spotify Premium にアップグレードしてください。再生制御以外 (Liked / Playlists / Recent / Search) は Free でも引き続き利用できます。",
  };
}

function summarisePlayerResult(kind: PlayerKind, data: NormalisedDevice[] | null) {
  if (kind === "getDevices") {
    const devices = (data ?? []) as NormalisedDevice[];
    if (devices.length === 0) {
      return {
        ok: true,
        message: "アクティブな Spotify デバイスがありません。Spotify アプリを起動してから再度お試しください。",
        data: devices,
      };
    }
    const lines = devices.map((d, i) => `${i + 1}. ${d.name} (${d.type})${d.isActive ? " — active" : ""}`);
    return { ok: true, message: `Devices (${devices.length}):\n${lines.join("\n")}`, data: devices };
  }
  return { ok: true, message: PLAYER_SUCCESS_MESSAGES[kind] };
}

const PLAYER_SUCCESS_MESSAGES: Record<Exclude<PlayerKind, "getDevices">, string> = {
  play: "再生を開始しました。",
  pause: "再生を一時停止しました。",
  next: "次の曲に進みました。",
  previous: "前の曲に戻りました。",
  seek: "位置をシークしました。",
  setVolume: "音量を変更しました。",
  transferPlayback: "再生をデバイスに移しました。",
};

function mapPlayerError(error: SpotifyClientError, kind: PlayerKind) {
  // Spotify returns 404 for "no active device" on most player
  // endpoints. Surface a user-friendly hint that points at the
  // device dropdown instead of the generic API-error message.
  if (error.kind === "spotify_api_error" && error.status === 404 && kind !== "getDevices") {
    return {
      ok: false,
      error: "no_active_device",
      message: "アクティブな Spotify デバイスがありません。Spotify アプリ (デスクトップ / モバイル / Web) を起動してから再度お試しください。",
      instructions: "View の Player タブから対象デバイスを選んで「Transfer」を押すか、Spotify アプリ側で何か再生してから再試行してください。",
    };
  }
  if (error.kind === "spotify_api_error" && error.status === 403 && error.body.includes("scope")) {
    return {
      ok: false,
      error: "scope_missing",
      message: "新しい権限の追加が必要です。Spotify View ヘッダの「Reconnect」ボタンを押して再認可してください。",
      instructions:
        "PR 3 で追加された Player 制御は新しい OAuth scope を要求します。View 右上の「Reconnect」ボタンで Spotify の同意画面を開き直すと scope が更新されます。",
    };
  }
  return mapClientError(error);
}

function mapClientError(error: SpotifyClientError) {
  switch (error.kind) {
    case "auth_expired":
      return {
        ok: false as const,
        error: "auth_expired",
        message: "認可が無効化されました。「Connect」をやり直してください。",
        detail: error.detail,
      };
    case "transient_error":
      return {
        ok: false as const,
        error: "transient_error",
        message: "Spotify に一時的に接続できませんでした。しばらくしてから再試行してください。",
        detail: error.detail,
      };
    case "rate_limited":
      return {
        ok: false as const,
        error: "rate_limited",
        message: `Spotify から rate limit を返されました。${error.retryAfterSec} 秒後に再試行してください。`,
        retryAfterSec: error.retryAfterSec,
      };
    case "spotify_api_error":
      return {
        ok: false as const,
        error: "spotify_api_error",
        message: `Spotify API がエラーを返しました (${error.status})`,
        detail: error.body,
      };
    case "not_connected":
      return { ok: false as const, error: "not_connected", message: "Spotify に未接続です。" };
  }
}

function renderCallbackHtml(params: { title: string; body: string }): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(params.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#111}h1{margin-bottom:1rem}pre{white-space:pre-wrap;background:#f5f5f5;padding:1rem;border-radius:.5rem}</style>
<h1>${escapeHtml(params.title)}</h1>
<pre>${escapeHtml(params.body)}</pre>
</html>`;
}
