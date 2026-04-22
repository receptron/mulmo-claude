// Navigation guard: validates and sanitizes URL parameters.
//
// All incoming route params / query values are untrusted — they could
// come from a user-typed URL, a pasted link, or a malicious redirect.
// This guard runs before every navigation and rewrites invalid state
// to safe defaults without the user noticing (router.replace, which
// doesn't push a history entry).

import type { Router } from "vue-router";

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
    if (dest.name === "chat") {
      const sessionId = dest.params.sessionId;
      if (typeof sessionId === "string" && sessionId.length > 0 && !isValidSessionId(sessionId)) {
        return { name: "chat", params: {}, query: {}, replace: true };
      }
    }

    if (dest.name === "files") {
      const filePath = dest.query.path;
      if (typeof filePath === "string" && (filePath.includes("..") || filePath.startsWith("/"))) {
        const cleaned = { ...dest.query };
        delete cleaned.path;
        return { ...dest, query: cleaned, replace: true };
      }
    }
  });
}
