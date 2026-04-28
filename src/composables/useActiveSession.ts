// Provide/inject so plugin Views see chatSessionId + pendingGenerations without threading props through every
// `<component :is="…">` mount point — and the spinner derived from pendingGenerations survives View remounts.

import { inject, provide, type Ref } from "vue";
import type { ActiveSession } from "../types/session";

// May be `undefined` during the brief window before the first session loads.
export type ActiveSessionRef = Ref<ActiveSession | undefined>;

const ACTIVE_SESSION_KEY = Symbol("activeSession");

export function provideActiveSession(ref: ActiveSessionRef): void {
  provide(ACTIVE_SESSION_KEY, ref);
}

// Returns `undefined` outside an App.vue subtree so plugins can render standalone in unit tests.
export function useActiveSession(): ActiveSessionRef | undefined {
  return inject<ActiveSessionRef>(ACTIVE_SESSION_KEY);
}
