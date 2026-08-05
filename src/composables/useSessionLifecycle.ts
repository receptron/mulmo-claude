// Session lifecycle: create / switch / load / resume a chat session.
// Extracted from App.vue (#2302) — the imperative shell over the pure
// rules in ../utils/session/sessionLifecycle.ts. Each step is a
// module-level function taking an explicit `LifecycleCtx` so the wiring
// stays flat and the cross-cutting state (sessionMap, role list, session
// summaries) plus the event-stream hook `ensureSessionSubscription` are
// injected — App.vue remains their single owner. A later PR extracts the
// event-stream concern (subscribe / dispatch / catch-up) on its own.

import { nextTick, type ComputedRef, type Ref } from "vue";
import { useRoute, useRouter, isNavigationFailure, NavigationFailureType } from "vue-router";
import { v4 as uuidv4 } from "uuid";
import type { ActiveSession, SessionEntry, SessionSummary } from "../types/session";
import type { Role } from "../config/roles";
import { PAGE_ROUTES } from "../router";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { perfLogSinceClick, perfTime, perfTimeAsync } from "../utils/devPerf";
import { createEmptySession } from "../utils/session/sessionFactory";
import { buildLoadedSession, parseSessionEntries, shouldAdoptServerTranscript } from "../utils/session/sessionEntries";
import {
  resolveNewSessionRoleId,
  shouldReplaceHistory,
  isSessionEmpty,
  isSessionAlreadyDisplayed,
  isOnTargetSessionRoute,
  resolveResumeAction,
  isAwaitedSession,
} from "../utils/session/sessionLifecycle";

interface LifecycleDeps {
  sessionMap: Map<string, ActiveSession>;
  currentSessionId: Ref<string>;
  isChatPage: Ref<boolean> | ComputedRef<boolean>;
  roles: Ref<Role[]>;
  currentRoleId: Ref<string>;
  sessions: Ref<SessionSummary[]>;
  mergedSessions: Ref<SessionSummary[]> | ComputedRef<SessionSummary[]>;
  ensureSessionSubscription: (session: ActiveSession) => void;
  focusChatInput: () => void;
  collapseChatSuggestions: () => void;
  /** Forget the chat draft of a session that is being thrown away.
   *  An evicted empty session has no route and no history row left, so
   *  its draft would otherwise sit in storage unreachable forever. */
  dropSessionDraft: (sessionId: string) => void;
}

type LifecycleCtx = LifecycleDeps & {
  route: ReturnType<typeof useRoute>;
  router: ReturnType<typeof useRouter>;
};

// The URL is the source of truth for "which session is on /chat";
// currentSessionId is written synchronously first so a follow-up
// sendMessage lands in the new session before the route settles.
function navigateToSession(ctx: LifecycleCtx, sessionId: string, replace = false): void {
  ctx.currentSessionId.value = sessionId;
  const method = replace ? ctx.router.replace : ctx.router.push;
  // A duplicated-navigation rejection (pushing the route we're already on)
  // is expected and noise; anything else is a real failure worth logging.
  method({ name: PAGE_ROUTES.chat, params: { sessionId } }).catch((err) => {
    if (!isNavigationFailure(err, NavigationFailureType.duplicated)) {
      console.error("[navigateToSession] push failed:", err);
    }
  });
}

// Evict the displayed session when it has no messages (never persisted).
// Returns whether it removed one, so the caller can replace instead of
// push and keep the throwaway URL out of history.
function removeCurrentIfEmpty(ctx: LifecycleCtx): boolean {
  const sessionId = ctx.currentSessionId.value;
  if (!sessionId) return false;
  const session = ctx.sessionMap.get(sessionId);
  if (session && isSessionEmpty(session)) {
    ctx.sessionMap.delete(sessionId);
    ctx.dropSessionDraft(sessionId);
    return true;
  }
  return false;
}

function createNewSession(ctx: LifecycleCtx, roleId?: string): ActiveSession {
  const replace = shouldReplaceHistory(removeCurrentIfEmpty(ctx), ctx.isChatPage.value);
  const rId = resolveNewSessionRoleId(
    roleId,
    ctx.currentRoleId.value,
    ctx.roles.value.map((role) => role.id),
  );
  const session = createEmptySession(uuidv4(), rId);
  ctx.sessionMap.set(session.id, session);
  navigateToSession(ctx, session.id, replace);
  ctx.collapseChatSuggestions();
  void nextTick(() => ctx.focusChatInput());
  return session;
}

// On non-chat pages the user is just picking the role that future
// new-chat actions should use — don't yank them onto /chat.
function onRoleChange(ctx: LifecycleCtx, roleId: string): void {
  if (!ctx.isChatPage.value) return;
  createNewSession(ctx, roleId);
}

function activateSession(ctx: LifecycleCtx, sessionId: string, replace: boolean): void {
  const reactiveSession = ctx.sessionMap.get(sessionId);
  if (reactiveSession) ctx.ensureSessionSubscription(reactiveSession);
  const routeSessionId = typeof ctx.route.params.sessionId === "string" ? ctx.route.params.sessionId : "";
  // Skip a redundant navigate when the URL already points at the target:
  // re-pushing the same path strips query strings (e.g. `?result=<uuid>`,
  // #762) because navigateToSession builds the location with params only.
  if (!isOnTargetSessionRoute(routeSessionId, sessionId, ctx.route.name === PAGE_ROUTES.chat)) {
    navigateToSession(ctx, sessionId, replace);
    return;
  }
  // Taking that shortcut skips the one thing navigateToSession also does.
  // The selection can sit ahead of the URL now that loadSession moves it
  // before the fetch, so returning to the session the URL already names
  // has to write the id back by hand — otherwise the selection stays
  // stuck on the abandoned in-flight one.
  ctx.currentSessionId.value = sessionId;
}

// Investigation instrumentation (src/utils/devPerf.ts): the two phases
// the click used to wait on before anything moved on screen. Since
// #2813 the row highlights before this runs, so these numbers now say
// how long the CONTENT lags the highlight rather than the whole click.
async function fetchLoadedSession(ctx: LifecycleCtx, sessionId: string): Promise<ActiveSession | null> {
  const response = await perfTimeAsync("loadSession: GET /sessions/:id", () =>
    apiGet<SessionEntry[]>(API_ROUTES.sessions.detail.replace(":id", encodeURIComponent(sessionId))),
  );
  if (!response.ok) return null;
  return perfTime(
    "loadSession: buildLoadedSession()",
    () =>
      buildLoadedSession({
        id: sessionId,
        entries: response.data,
        defaultRoleId: ctx.roles.value[0]?.id ?? "",
        serverSummary: ctx.sessions.value.find((summary) => summary.id === sessionId),
        nowIso: new Date().toISOString(),
      }),
    { entries: response.data.length },
  );
}

async function loadSession(ctx: LifecycleCtx, sessionId: string): Promise<void> {
  if (isSessionAlreadyDisplayed(sessionId, ctx.currentSessionId.value, ctx.sessionMap.has(sessionId))) return;
  const previousSessionId = ctx.currentSessionId.value;
  const replaced = shouldReplaceHistory(removeCurrentIfEmpty(ctx), ctx.isChatPage.value);
  if (ctx.sessionMap.has(sessionId)) {
    activateSession(ctx, sessionId, replaced);
    perfLogSinceClick("loadSession cached→paint", { sessionId });
    return;
  }
  // Highlight the row on the click instead of a round trip later (#2809).
  // The URL still settles in activateSession once the transcript is in
  // the map, so undoing a failed load is a ref assignment and never a
  // second navigation.
  ctx.currentSessionId.value = sessionId;
  const newSession = await fetchLoadedSession(ctx, sessionId);
  const stillAwaited = isAwaitedSession(ctx.currentSessionId.value, sessionId);
  if (newSession === null) {
    if (stillAwaited) ctx.currentSessionId.value = previousSessionId;
    return;
  }
  // Keep the transcript even when the user has moved on — it is valid,
  // and their next click on this session then costs no round trip.
  ctx.sessionMap.set(sessionId, newSession);
  if (stillAwaited) activateSession(ctx, sessionId, replaced);
  perfLogSinceClick("loadSession fetched→paint", { sessionId, stillAwaited });
}

// Re-fetch the transcript and patch entries missed via a dropped socket
// frame. Only adopts the server view when it is strictly richer (#2096),
// so it stays idempotent against races with live events.
async function refreshSessionTranscript(ctx: LifecycleCtx, sessionId: string): Promise<void> {
  const session = ctx.sessionMap.get(sessionId);
  if (!session) return;
  const response = await apiGet<SessionEntry[]>(API_ROUTES.sessions.detail.replace(":id", encodeURIComponent(sessionId)));
  if (!response.ok) return;
  const summary = ctx.sessions.value.find((entry) => entry.id === sessionId);
  const serverResults = parseSessionEntries(response.data, summary?.origin);
  if (shouldAdoptServerTranscript(serverResults, session.toolResults)) {
    session.toolResults = serverResults;
  }
}

// Land on /chat with no specific session in mind (initial load / home
// button): resume the most-recent session, creating a fresh one only
// when there is no history at all.
async function resumeOrCreateChatSession(ctx: LifecycleCtx): Promise<void> {
  const topId = ctx.mergedSessions.value[0]?.id;
  const action = resolveResumeAction(topId, topId !== undefined && ctx.sessionMap.has(topId));
  if (action === "create" || topId === undefined) {
    createNewSession(ctx);
    return;
  }
  if (action === "activate") {
    activateSession(ctx, topId, false);
    return;
  }
  // loadSession silently returns on fetch failure; fall back to a fresh
  // session so /chat is never left without an active one.
  await loadSession(ctx, topId);
  if (!ctx.sessionMap.has(topId)) createNewSession(ctx);
}

export function useSessionLifecycle(deps: LifecycleDeps) {
  const ctx: LifecycleCtx = { ...deps, route: useRoute(), router: useRouter() };
  return {
    removeCurrentIfEmpty: () => removeCurrentIfEmpty(ctx),
    createNewSession: (roleId?: string) => createNewSession(ctx, roleId),
    onRoleChange: (roleId: string) => onRoleChange(ctx, roleId),
    loadSession: (sessionId: string) => loadSession(ctx, sessionId),
    refreshSessionTranscript: (sessionId: string) => refreshSessionTranscript(ctx, sessionId),
    resumeOrCreateChatSession: () => resumeOrCreateChatSession(ctx),
  };
}
