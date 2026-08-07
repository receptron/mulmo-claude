// Pure decision rules for the remote-host connection watcher, split from
// useRemoteHost.ts so they unit-test without Firebase or a browser.

export interface RemoteHostSignals {
  // A session blob parked in localStorage ⇒ the user wants to be connected. We
  // only auto-reconnect / warn when there is intent — never nag someone who never
  // enabled the remote host.
  intended: boolean;
  connected: boolean;
  reconnectInFlight: boolean;
  // A silent auto-reconnect has already failed (e.g. the parked blob expired and
  // a Google popup is now required).
  reconnectFailed: boolean;
}

// Silently re-attach from the parked blob when the user wants to be connected but
// isn't — without overlapping an in-flight attempt.
export const shouldAutoReconnect = (signals: RemoteHostSignals): boolean => signals.intended && !signals.connected && !signals.reconnectInFlight;

// Show the persistent banner only after a silent reconnect has FAILED, so it
// doesn't flash during a normal quick restart that the next poll heals on its own.
export const shouldShowRemoteHostBanner = (signals: RemoteHostSignals): boolean => signals.intended && !signals.connected && signals.reconnectFailed;

export interface ReconnectStateUpdate {
  // Remove the parked blob from storage.
  dropBlob: boolean;
  // Surface the reconnect banner.
  failed: boolean;
}

// How to update stored state after a popup-free reconnect attempt. The parked
// blob is dropped ONLY when the server says it's genuinely expired (`unauthorized`)
// — a transient failure keeps it for the next poll's retry. Intent is NEVER
// cleared here (only an explicit disconnect clears it), so the banner keeps
// prompting a manual re-login even after the dead blob is removed.
export const reconnectStateUpdate = (ok: boolean, status: number, unauthorized: number): ReconnectStateUpdate =>
  ok ? { dropBlob: false, failed: false } : { dropBlob: status === unauthorized, failed: true };

// --- Google sign-in failures -------------------------------------------------
//
// `errorMessage(err, fallback)` returns `err.message` whenever there is one, so
// the i18n fallback passed to it is unreachable for anything Firebase throws —
// the user just gets raw English. These are the failures that are actually
// reachable in the remote-host flow, each mapped to a message that says what to
// DO about it rather than restating what went wrong.
const SIGN_IN_ERROR_KEYS: Readonly<Record<string, string>> = {
  "auth/popup-blocked": "remoteHost.signInPopupBlocked",
  "auth/popup-closed-by-user": "remoteHost.signInCancelled",
  "auth/cancelled-popup-request": "remoteHost.signInCancelled",
  "auth/unauthorized-domain": "remoteHost.signInUnauthorizedDomain",
  "auth/network-request-failed": "remoteHost.signInNetworkFailed",
};

// `IndexedDBLocalPersistence._openDb()` throws a bare `Error` with this exact
// text — no `code` to match on. See the comment in src/config/firebase.ts for
// why it fires and why in-memory persistence should prevent it; this stays as a
// safety net in case a future Firebase version reintroduces the path.
const IDB_HIDDEN_MESSAGE = "Database is closing/hidden";

// `code` is present on a FirebaseError and absent on a plain Error.
const errorCode = (err: unknown): string => (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : "");

/**
 * i18n key describing a Google sign-in failure in actionable terms, or `null`
 * when the failure isn't one we recognise (caller falls back to the raw message).
 */
export const signInErrorKey = (err: unknown): string | null => {
  const mapped = SIGN_IN_ERROR_KEYS[errorCode(err)];
  if (mapped) return mapped;
  if (err instanceof Error && err.message.includes(IDB_HIDDEN_MESSAGE)) return "remoteHost.signInStorageBlocked";
  return null;
};
