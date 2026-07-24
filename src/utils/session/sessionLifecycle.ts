// Pure decision rules pulled out of App.vue's session-lifecycle
// functions (createNewSession / loadSession / activateSession /
// removeCurrentIfEmpty / resumeOrCreateChatSession). Kept side-effect
// free so the branch logic is unit-testable without a component,
// router, or reactive state. The composable `useSessionLifecycle`
// holds the imperative shell that calls these.

// Role a freshly-created session should use. The "+" button and the
// role-change handler pass an explicit id; plugin-driven startNewChat,
// bootstrap, and post-failure recovery omit it and inherit the
// dropdown's current pick, falling back to the first available role.
// The trailing "" only matters before any role has seeded.
export function resolveNewSessionRoleId(explicitRoleId: string | undefined, currentRoleId: string, roleIds: readonly string[]): string {
  return explicitRoleId ?? (currentRoleId || roleIds[0] || "");
}

// router.replace vs router.push is derived from state: replace only
// when we just discarded an empty session AND we're on /chat — that
// keeps the throwaway empty-session URL out of browser history without
// swallowing a real transcript or a non-chat page the user came from.
export function shouldReplaceHistory(removedEmptySession: boolean, onChatPage: boolean): boolean {
  return removedEmptySession && onChatPage;
}

// A session with no results was never sent to; we don't persist those,
// so removeCurrentIfEmpty evicts them on navigate.
export function isSessionEmpty(session: { toolResults: readonly unknown[] }): boolean {
  return session.toolResults.length === 0;
}

// loadSession's early-return guard: nothing to do when the requested
// session is the one already displayed on /chat. currentSessionId is
// "" off /chat, so a history-panel click there never matches and always
// navigates.
export function isSessionAlreadyDisplayed(sessionId: string, currentSessionId: string, sessionInMemory: boolean): boolean {
  return sessionId === currentSessionId && sessionInMemory;
}

// activateSession skips a redundant navigate when the URL already points
// at the target session. Re-pushing the same path strips query strings
// (e.g. the `?result=<uuid>` notification permalink, #762), so the guard
// matters even though the visible route looks unchanged.
export function isOnTargetSessionRoute(currentRouteSessionId: string, targetSessionId: string, onChatPage: boolean): boolean {
  return onChatPage && currentRouteSessionId === targetSessionId;
}

export type ResumeAction = "create" | "activate" | "load";

// Landing on /chat with no specific session in mind (initial load /
// home button): resume the most-recent session when there is one,
// activating it in place if already in memory, otherwise loading it;
// only create a fresh session when there is no history at all.
export function resolveResumeAction(topSessionId: string | undefined, topSessionInMemory: boolean): ResumeAction {
  if (!topSessionId) return "create";
  if (topSessionInMemory) return "activate";
  return "load";
}
