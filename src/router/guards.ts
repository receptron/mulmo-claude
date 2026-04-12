// Navigation guard: validates and sanitizes URL parameters.
//
// All incoming route params / query values are untrusted — they could
// come from a user-typed URL, a pasted link, or a malicious redirect.
// This guard runs before every navigation and rewrites invalid state
// to safe defaults without the user noticing (router.replace, which
// doesn't push a history entry).
//
// Phase 0: only the `view` query whitelist is enforced. Later phases
// will add sessionId existence checks, path traversal rejection, etc.

import type { Router } from "vue-router";

const VALID_VIEW_MODES = new Set(["single", "stack", "files"]);

export function installGuards(router: Router): void {
  router.beforeEach((to) => {
    // Only run guards on the chat route — other routes (redirect, etc.)
    // don't carry parameters that need sanitizing.
    if (to.name !== "chat") return;

    // ── view mode whitelist ──────────────────────────────────────
    const view = to.query.view;
    if (typeof view === "string" && !VALID_VIEW_MODES.has(view)) {
      // Strip the bad value and fall through to the default (single).
      const cleaned = { ...to.query };
      delete cleaned.view;
      return { ...to, query: cleaned, replace: true };
    }
  });
}
