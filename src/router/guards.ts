// Navigation guard: validates and sanitizes URL parameters.
//
// All incoming route params / query values are untrusted — they could
// come from a user-typed URL, a pasted link, or a malicious redirect.
// This guard runs before every navigation and rewrites invalid state
// to safe defaults without the user noticing (router.replace, which
// doesn't push a history entry).

import type { Router } from "vue-router";
import { readPathMatch } from "../composables/useFileSelection";
import { readWikiRouteTarget } from "../plugins/wiki/route";
import { isNonEmptyString } from "../utils/types";

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
      const { sessionId } = dest.params;
      if (isNonEmptyString(sessionId) && !isValidSessionId(sessionId)) {
        return { name: "chat", params: {}, query: {}, replace: true };
      }
    }

    if (dest.name === "wiki") {
      // Vue Router decodes `%2F` back to `/` in `route.params.slug`,
      // so `/wiki/pages/..%2Fsecrets` arrives here as
      // `{ section: "pages", slug: "../secrets" }`. `readWikiRouteTarget`
      // returns `null` for unsafe slugs, a missing slug on the `pages`
      // section, or an unknown section. In any of those cases, bounce
      // to `/wiki` with `replace: true` so no broken URL lands in
      // history. Legal targets fall through to the view, where the
      // route watcher drives the fetch.
      if (readWikiRouteTarget(dest.params) === null) {
        return { name: "wiki", params: {}, query: dest.query, replace: true };
      }
    }

    if (dest.name === "files") {
      // Back-compat: old query-string form `/files?path=foo.md` →
      // rewrite to the new path form `/files/foo.md`. Silent
      // replace so bookmarks / log links keep working. Do this
      // before the traversal check so `?path=../bad` also lands in
      // the `..` rejection below.
      const legacyPath = dest.query.path;
      if (isNonEmptyString(legacyPath)) {
        const cleaned = { ...dest.query };
        delete cleaned.path;
        return {
          name: "files",
          params: { pathMatch: legacyPath.split("/") },
          query: cleaned,
          replace: true,
        };
      }

      // Traversal / absolute-path rejection against the new param.
      const filePath = readPathMatch(dest.params.pathMatch);
      if (typeof filePath === "string" && (filePath.includes("..") || filePath.startsWith("/"))) {
        return {
          name: "files",
          params: { pathMatch: [] },
          query: dest.query,
          replace: true,
        };
      }
    }
  });
}
