// #227: replaced window CustomEvent dispatch (`roles-updated`, `skill-run`) with provide/inject so plugin → App
// communication is type-checked instead of routed through string event names.

import { inject, provide } from "vue";

export interface AppApi {
  refreshRoles: () => void | Promise<void>;
  sendMessage: (message: string) => void;
  // roleId overrides for one-off sessions (e.g. wiki lint must run as General even if the user is on a different role).
  startNewChat: (message: string, roleId?: string) => void;
  navigateToWorkspacePath: (href: string) => void;
  // Live SSE stream stamps real arrival times; jsonl-loaded results fall back to the session's startedAt baseline
  // because per-entry timestamps aren't persisted yet (see pushResult in utils/session/sessionHelpers.ts).
  getResultTimestamp: (uuid: string) => number | undefined;
}

const APP_API_KEY = Symbol("appApi");

export function provideAppApi(api: AppApi): void {
  provide(APP_API_KEY, api);
}

// Throws when called outside an App.vue subtree; tests that render a plugin in isolation should call inject directly.
export function useAppApi(): AppApi {
  const api = inject<AppApi>(APP_API_KEY);
  if (!api) {
    throw new Error("useAppApi() called outside an App.vue subtree — provideAppApi must run first.");
  }
  return api;
}
