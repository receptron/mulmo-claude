// Navigation guard: validates and sanitizes URL parameters.
//
// All incoming route params / query values are untrusted — they could
// come from a user-typed URL, a pasted link, or a malicious redirect.
// This guard runs before every navigation and rewrites invalid state
// to safe defaults without the user noticing (router.replace, which
// doesn't push a history entry).

import type { Router } from "vue-router";
import { VALID_VIEW_MODES } from "../utils/canvas/viewMode";

// Basic sanity check for a session ID. Real existence verification
// happens in App.vue's onMounted / loadSession — we can't do async
// server calls in a synchronous beforeEach guard without making
// every navigation await a fetch. Instead, reject values that are
// obviously malicious (HTML tags, extremely long, contain path
// separators) and let the app-level code handle "valid format but
// doesn't exist on the server" gracefully.
const SESSION_ID_RE = /^[\w-]{1,128}$/;

function isValidSessionId(value: unknown): boolean {
  return typeof value === "string" && SESSION_ID_RE.test(value);
}

export function installGuards(router: Router): void {
  router.beforeEach((dest) => {
    // Only run guards on the chat route — other routes (redirect, etc.)
    // don't carry parameters that need sanitizing.
    if (dest.name !== "chat") return;

    // ── sessionId format check ───────────────────────────────────
    const sessionId = dest.params.sessionId;
    if (typeof sessionId === "string" && sessionId.length > 0 && !isValidSessionId(sessionId)) {
      // Garbage sessionId → strip it and go to /chat (new session).
      return { name: "chat", params: {}, query: {}, replace: true };
    }

    // ── view mode whitelist ──────────────────────────────────────
    const view = dest.query.view;
    if (typeof view === "string" && !VALID_VIEW_MODES.has(view)) {
      const cleaned = { ...dest.query };
      delete cleaned.view;
      return { ...dest, query: cleaned, replace: true };
    }

    // ── file path traversal check ────────────────────────────────
    const filePath = dest.query.path;
    if (typeof filePath === "string") {
      if (filePath.includes("..") || filePath.startsWith("/")) {
        const cleaned = { ...dest.query };
        delete cleaned.path;
        return { ...dest, query: cleaned, replace: true };
      }

      // ?path= without ?view=files → auto-add view=files so FilesView mounts.
      if (view !== "files") {
        return { ...dest, query: { ...dest.query, view: "files" }, replace: true };
      }
    }
  });
}
