// Vue provide/inject contract that lets plugin Views call back into
// App.vue without going through window-level CustomEvents.
//
// Background: plugins like manageRoles and manageSkills used to
// dispatch `roles-updated` / `skill-run` on `window` and App.vue
// listened with `addEventListener`. That worked but routed
// component-to-component communication through a global side channel,
// which got hard to follow as more plugins came online (#227).
//
// `provide` / `inject` is the Vue-native equivalent: App.vue provides
// a small typed API surface, plugins inject and call methods directly.
// No string event names, full type-checking, no chance of a typo
// silently failing.

import { inject, provide } from "vue";

/** API surface that plugin Views can call on App.vue. */
export interface AppApi {
  /** Refresh the role dropdown — call after the roles list changes. */
  refreshRoles: () => void | Promise<void>;
  /** Send a chat message through App.vue's normal sendMessage pipeline. */
  sendMessage: (message: string) => void;
  /**
   * Open a fresh chat session and send `message` as its first turn.
   * Used by plugin views that want to kick off a new conversation
   * instead of threading into whatever session happens to be active.
   * Pass `roleId` to override the role for this one session (e.g. a
   * wiki lint needs the General role even if the user is currently
   * viewing the wiki under a different role); omit it to inherit the
   * currently selected role.
   */
  startNewChat: (message: string, roleId?: string) => void;
  /** Navigate to a workspace-internal link (wiki page, file, session). */
  navigateToWorkspacePath: (href: string) => void;
  /**
   * Look up the timestamp (epoch ms) recorded for a tool result in
   * the active session's `resultTimestamps` map. For results that
   * arrived via the live SSE stream this is the actual time the
   * result was added; for results loaded from a saved jsonl this is
   * the session's `startedAt` baseline (per-entry timestamps aren't
   * persisted in the jsonl yet — see `pushResult` in
   * `utils/session/sessionHelpers.ts`). Returns `undefined` when the
   * uuid isn't in the active session.
   */
  getResultTimestamp: (uuid: string) => number | undefined;
}

const APP_API_KEY = Symbol("appApi");

/** Called once in App.vue setup to expose the API to descendants. */
export function provideAppApi(api: AppApi): void {
  provide(APP_API_KEY, api);
}

/**
 * Called by plugin Views (any descendant of App.vue) to access the API.
 *
 * Throws if used outside an App.vue subtree — if you need a no-op
 * fallback (e.g. a plugin rendered in isolation in a test), pass a
 * default-returning callback to `inject` directly instead.
 */
export function useAppApi(): AppApi {
  const api = inject<AppApi>(APP_API_KEY);
  if (!api) {
    throw new Error("useAppApi() called outside an App.vue subtree — provideAppApi must run first.");
  }
  return api;
}
