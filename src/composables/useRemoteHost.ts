// Shared remote-host connection store: one module-scoped singleton consumed by
// both the toolbar control (RemoteHostControl.vue) and the offline banner
// (RemoteHostOfflineBanner.vue). It polls presence, silently re-attaches from the
// browser-parked session blob when the host drops (server restart / listener
// death), and exposes a `needsReconnect` signal for the banner.
//
// The pure decision rules live in ./remoteHostDecisions (unit-tested without
// Firebase); everything stateful/side-effecting is here.
import { computed, ref, type ComputedRef, type Ref } from "vue";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";

import { auth } from "../config/firebase";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet, apiPost } from "../utils/api";
import { errorMessage } from "../utils/errors";
import i18n from "../lib/vue-i18n";
import { reconnectStateUpdate, shouldAutoReconnect, shouldShowRemoteHostBanner, signInErrorKey, type RemoteHostSignals } from "./remoteHostDecisions";

const translate = (key: string): string => i18n.global.t(key);

export interface RemoteHostStatus {
  connected: boolean;
  uid: string | null;
}
interface StatusResponse {
  status: RemoteHostStatus;
  // The server's Firebase session blob (refresh token included); null when
  // disconnected. Parked in localStorage so a restart reconnects without a popup.
  session: string | null;
}

// Poll cadence for remote-host presence — matches the 15s health cadence so a
// server restart / listener death surfaces (and silently auto-reconnects) within
// one interval instead of only when the popover is opened.
const REMOTE_HOST_POLL_MS = 15_000;

// Same-machine (localhost) trust model — see mulmoserver#50.
const SESSION_KEY = "remoteHost.session";
// Reconnect status meaning "this blob is expired/invalid" (vs a transient
// failure), so only then do we drop the parked session.
const UNAUTHORIZED = 401;

const loadStoredSession = (): string | null => {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
};

const status = ref<RemoteHostStatus>({ connected: false, uid: null });
const error = ref<string | null>(null);
const busy = ref(false);
const reconnectInFlight = ref(false);
const reconnectFailed = ref(false);
// "The user wants to be connected." Tracked separately from blob presence so a
// genuinely-expired blob can be dropped (stops /reconnect retries on a dead blob)
// WITHOUT hiding the reconnect banner. Only an explicit disconnect clears intent.
const hasIntent = ref<boolean>(loadStoredSession() !== null);

const persistSession = (blob: string | null): void => {
  try {
    if (blob) localStorage.setItem(SESSION_KEY, blob);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable — reconnect just won't survive a restart */
  }
};

const signals = (): RemoteHostSignals => ({
  intended: hasIntent.value,
  connected: status.value.connected,
  reconnectInFlight: reconnectInFlight.value,
  reconnectFailed: reconnectFailed.value,
});

const needsReconnect: ComputedRef<boolean> = computed(() => shouldShowRemoteHostBanner(signals()));

const refreshStatus = async (): Promise<void> => {
  const res = await apiGet<StatusResponse>(API_ROUTES.remoteHost.status);
  if (!res.ok) {
    error.value = res.error || translate("remoteHost.statusFailed");
    return;
  }
  status.value = res.data.status;
  // Keep the parked blob fresh (the refresh token can rotate) — but never clear
  // it on a disconnected status, so an auto-reconnect still has it.
  if (res.data.session) {
    persistSession(res.data.session);
    hasIntent.value = true;
  }
  if (res.data.status.connected) reconnectFailed.value = false;
  error.value = null;
};

// Only ever called behind `shouldAutoReconnect` (intended && !connected), so a
// missing blob here means we can't silently recover — surface the banner for a
// popup re-login (which needs no blob) instead of returning silently.
const tryAutoReconnect = async (): Promise<void> => {
  const blob = loadStoredSession();
  if (!blob) {
    reconnectFailed.value = true;
    return;
  }
  reconnectInFlight.value = true;
  try {
    const res = await apiPost<StatusResponse>(API_ROUTES.remoteHost.reconnect, { session: blob });
    if (res.ok) {
      status.value = res.data.status;
      persistSession(res.data.session);
      hasIntent.value = true;
      reconnectFailed.value = false;
    } else {
      // 401 → drop the genuinely-expired blob (so the next poll won't retry a dead
      // blob) but KEEP intent, so the banner keeps prompting a manual re-login.
      // Transient (network / 5xx) → keep the blob; the next poll retries silently.
      const { dropBlob, failed } = reconnectStateUpdate(res.ok, res.status, UNAUTHORIZED);
      if (dropBlob) persistSession(null);
      reconnectFailed.value = failed;
    }
  } finally {
    reconnectInFlight.value = false;
  }
};

const watchTick = async (): Promise<void> => {
  await refreshStatus();
  if (shouldAutoReconnect(signals())) await tryAutoReconnect();
};

let pollHandle: number | null = null;

const startWatching = (): void => {
  if (pollHandle !== null) return;
  void watchTick();
  pollHandle = window.setInterval(() => void watchTick(), REMOTE_HOST_POLL_MS);
};

const stopWatching = (): void => {
  if (pollHandle === null) return;
  window.clearInterval(pollHandle);
  pollHandle = null;
};

// Google sign-in popup → extract the OAuth idToken → POST /connect. MUST be
// called from a user gesture (the popup is otherwise blocked).
const connect = async (): Promise<void> => {
  busy.value = true;
  error.value = null;
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const idToken = GoogleAuthProvider.credentialFromResult(result)?.idToken;
    if (!idToken) {
      error.value = translate("remoteHost.noToken");
      return;
    }
    const res = await apiPost<StatusResponse>(API_ROUTES.remoteHost.connect, { idToken });
    if (!res.ok) {
      error.value = res.error || translate("remoteHost.connectFailed");
      return;
    }
    status.value = res.data.status;
    persistSession(res.data.session);
    hasIntent.value = true;
    reconnectFailed.value = false;
  } catch (err) {
    // Recognised Firebase failures get an actionable message; anything else
    // falls back to the raw text, which is still better than a generic string.
    const key = signInErrorKey(err);
    error.value = key ? translate(key) : errorMessage(err, translate("remoteHost.signInFailed"));
  } finally {
    busy.value = false;
  }
};

const disconnect = async (): Promise<void> => {
  busy.value = true;
  error.value = null;
  try {
    const res = await apiPost<StatusResponse>(API_ROUTES.remoteHost.disconnect);
    if (!res.ok) {
      error.value = res.error || translate("remoteHost.disconnectFailed");
      return;
    }
    status.value = res.data.status;
    persistSession(null); // forget the parked session on an explicit disconnect
    hasIntent.value = false;
    reconnectFailed.value = false;
  } catch (err) {
    error.value = errorMessage(err, translate("remoteHost.disconnectFailed"));
  } finally {
    busy.value = false;
  }
};

export interface RemoteHostStore {
  status: Ref<RemoteHostStatus>;
  error: Ref<string | null>;
  busy: Ref<boolean>;
  needsReconnect: ComputedRef<boolean>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  startWatching: () => void;
  stopWatching: () => void;
}

export function useRemoteHost(): RemoteHostStore {
  return { status, error, busy, needsReconnect, connect, disconnect, refreshStatus, startWatching, stopWatching };
}
