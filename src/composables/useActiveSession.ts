// Provide/inject contract for the currently-active chat session.
//
// Plugin Views (e.g. MulmoScript) need two things from the app-level
// session state:
//
//   1. The `chatSessionId` so they can tag long-running work (image /
//      audio / movie generation) on the right session channel.
//   2. A reactive view of `pendingGenerations` so they can derive
//      per-beat / per-character "rendering" spinners from the same
//      map the sidebar busy-indicator reads. This lets the spinner
//      survive View unmount/remount across session switches.
//
// Rather than thread two new props through every plugin's
// `<component :is="...">` mount point, we expose the active session
// via provide/inject — same pattern as useAppApi.

import { inject, provide, type Ref } from "vue";
import type { ActiveSession } from "../types/session";

/**
 * Ref to the currently-active session. May be `undefined` during the
 * brief window before the first session loads.
 */
export type ActiveSessionRef = Ref<ActiveSession | undefined>;

const ACTIVE_SESSION_KEY = Symbol("activeSession");

/** Called once in App.vue setup to expose the ref to descendants. */
export function provideActiveSession(ref: ActiveSessionRef): void {
  provide(ACTIVE_SESSION_KEY, ref);
}

/**
 * Plugin Views call this to observe the active session. Returns
 * `undefined` when used outside an App.vue subtree (e.g. in a unit
 * test) so plugins can render standalone without the provider.
 */
export function useActiveSession(): ActiveSessionRef | undefined {
  return inject<ActiveSessionRef>(ACTIVE_SESSION_KEY);
}
