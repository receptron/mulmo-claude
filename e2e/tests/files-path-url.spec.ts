// E2E coverage for the path-based Files URL (#632 / PR #633).
//
// The switch from `/files?path=foo.md` to `/files/foo.md` moves the
// captured file path from a query param to a Vue Router catch-all
// param. The router encodes each segment independently, so any bug
// in the param-array push path, the back-compat redirect, or the
// watcher would silently break deep links — especially for names
// with multi-byte or reserved ASCII characters. These tests exercise
// the full matrix.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { API_ROUTES } from "../../src/config/apiRoutes";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";

// ── Fixture names with a wide mix of "interesting" characters ───
//
// Each entry is a workspace-relative path. The router must round-trip
// every one of these through `/files/<path>` without mangling the
// filename when it's handed back to the content-fetch API.
//
// No raw `/` in a basename — POSIX / Windows forbid it, so the
// filesystem can never produce one; the router layer doesn't need
// to handle it. Raw `?` / `#` / `%` in a basename are legal on disk
// but require URL-encoding in the address bar.
const WEIRD_NAMES: readonly { label: string; path: string }[] = [
  { label: "ASCII baseline", path: "artifacts/documents/17c48329.md" },
  { label: "deep nesting (6 levels)", path: "a/b/c/d/e/f.md" },
  { label: "spaces in basename", path: "notes/my cool notes.md" },
  { label: "spaces in directory", path: "deep notes/draft one.md" },
  { label: "dots and hyphens", path: "artifacts/docs/file.v1_beta-draft.md" },
  { label: "parens", path: "artifacts/docs/file (copy 1).md" },
  { label: "brackets", path: "artifacts/docs/[tag]note.md" },
  { label: "braces", path: "artifacts/docs/{var}note.md" },
  { label: "ampersand", path: "artifacts/docs/Q&A.md" },
  { label: "apostrophe", path: "artifacts/docs/it's.md" },
  { label: "comma and semicolon", path: "artifacts/docs/a,b;c.md" },
  { label: "equals sign", path: "artifacts/docs/key=val.md" },
  { label: "at sign", path: "artifacts/docs/@mentions.md" },
  { label: "plus sign", path: "artifacts/docs/C++tips.md" },
  { label: "percent literal", path: "artifacts/docs/100%done.md" },
  { label: "hash/fragment char", path: "artifacts/docs/#1-priority.md" },
  { label: "question mark", path: "artifacts/docs/how-to?.md" },
  { label: "Japanese (kanji + kana)", path: "wiki/日本語ノート.md" },
  { label: "Korean (hangul)", path: "wiki/한국어메모.md" },
  { label: "Chinese (simplified)", path: "wiki/中文备忘.md" },
  { label: "Arabic RTL", path: "wiki/ملاحظة عربية.md" },
  { label: "Cyrillic", path: "wiki/заметка.md" },
  { label: "Greek", path: "wiki/σημείωση.md" },
  { label: "emoji (BMP + surrogate pair)", path: "notes/🎉party-📝plan.md" },
  { label: "accented Latin", path: "notes/café-résumé.md" },
  { label: "combining diacritic (NFD)", path: "notes/café.md" },
  { label: "mixed script + emoji + space", path: "notes/日本語 notes 🗾 draft.md" },
  { label: "all-numeric basename", path: "notes/12345.md" },
  { label: "dot-prefixed hidden-style", path: "notes/.draft.md" },
  { label: "very long basename", path: `notes/${"x".repeat(180)}.md` },
];

// Body of the mocked response. Kept distinct per-path so the DOM
// assertion ("does the fetched content show up?") proves the URL
// survived the round trip unmangled. Deliberately plain text with no
// markdown syntax so the rendered DOM contains the sentinel verbatim
// (a leading `#` would be stripped into an h1's text content and
// break `getByText` matches).
function bodyFor(path: string): string {
  return `SENTINEL-BODY ${path}`;
}

// ── Shared mock installation ────────────────────────────────────

async function installFileMocks(page: Page, fixtures: readonly { path: string }[]): Promise<void> {
  await mockAllApis(page);

  // Tree: empty but valid — the deep-link tests don't click through
  // the tree, they navigate straight to the URL. We still need a
  // 200 response or FilesView.vue surfaces a tree error banner.
  await page.route(
    (url) => url.pathname === API_ROUTES.files.tree,
    (route) =>
      route.fulfill({
        json: { name: "", path: "", type: "dir", children: [] },
      }),
  );
  await page.route(
    (url) => url.pathname === API_ROUTES.files.dir,
    (route) =>
      route.fulfill({
        json: { name: "", path: "", type: "dir", children: [] },
      }),
  );

  // Playwright matches routes in REVERSE registration order (last
  // registered is checked first). Register the 404 catch-all FIRST
  // so it runs LAST — if a fixture doesn't match its specific route,
  // we get a clean 404 instead of a silent fallthrough.
  await page.route(
    (url) => url.pathname === API_ROUTES.files.content,
    (route) => route.fulfill({ status: 404, json: { error: "not found" } }),
  );

  // Content endpoint: exact-match each fixture path. The client hits
  // `/api/files/content?path=<decoded>` — if the router mangled the
  // param (e.g. didn't decode UTF-8, or collapsed a `/`), the lookup
  // key would miss and we'd fall through to the 404 above.
  for (const { path } of fixtures) {
    await page.route(
      (url) => url.pathname === API_ROUTES.files.content && url.searchParams.get("path") === path,
      (route) =>
        route.fulfill({
          json: {
            kind: "text",
            path,
            content: bodyFor(path),
            size: bodyFor(path).length,
            modifiedMs: Date.now(),
          },
        }),
    );
  }
}

// Build the URL the browser bar would show, matching what the router
// produces via `router.push({ params: { pathMatch: path.split("/") } })`.
// Each segment gets `encodeURIComponent` (which encodes `?#%&+=` among
// others) and the slashes between segments stay raw.
function buildPathUrl(path: string): string {
  return `/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// ── Direct deep-link round-trip ─────────────────────────────────
//
// For every weird name: navigate straight to /files/<encoded>, check
// the mocked content renders (proving the param survived the decode
// and reached the content endpoint intact).

test.describe("deep link / files/<path>: character round-trip", () => {
  test.beforeEach(async ({ page }) => {
    await installFileMocks(page, WEIRD_NAMES);
  });

  for (const { label, path } of WEIRD_NAMES) {
    test(`opens file with ${label}`, async ({ page }) => {
      await page.goto(buildPathUrl(path));
      await expect(page.getByText(bodyFor(path)).first()).toBeVisible({
        timeout: 5 * ONE_SECOND_MS,
      });
    });
  }
});

// ── Back-compat: old ?path= form ────────────────────────────────
//
// Bookmarks, pasted links, and doc cross-refs from before the switch
// should keep working. The guard rewrites `/files?path=foo` to
// `/files/foo` with replace:true — verify both the final URL and
// the content render.

test.describe("back-compat: /files?path= redirects to /files/<path>", () => {
  test.beforeEach(async ({ page }) => {
    await installFileMocks(page, WEIRD_NAMES);
  });

  for (const { label, path } of WEIRD_NAMES) {
    test(`redirects for ${label}`, async ({ page }) => {
      // The old URL form uses query-string encoding, which handles
      // the raw characters fine — the browser escapes them for us.
      await page.goto(`/files?path=${encodeURIComponent(path)}`);
      // Content renders → proves the redirect + decode worked.
      await expect(page.getByText(bodyFor(path)).first()).toBeVisible({
        timeout: 5 * ONE_SECOND_MS,
      });
      // Final URL should NOT still carry `?path=`; the guard stripped
      // it and moved the value into the path.
      await expect(async () => {
        const parsed = new URL(page.url());
        expect(parsed.searchParams.get("path")).toBeNull();
        expect(parsed.pathname.startsWith("/files/")).toBe(true);
      }).toPass({ timeout: 5 * ONE_SECOND_MS });
    });
  }
});

// ── Security: traversal / absolute-path rejection ───────────────
//
// The guard must reject `..` segments and leading `/`, redirecting
// to the empty `/files` state without selecting anything. The guard
// runs against BOTH the legacy query form (back-compat redirect → new
// form → traversal check) and the direct path form.

test.describe("rejections", () => {
  test.beforeEach(async ({ page }) => {
    await installFileMocks(page, WEIRD_NAMES);
  });

  // Raw `../` segments in a URL are normalised by the browser before
  // the request leaves (the URL spec mandates this), so `page.goto`
  // with `/files/../../../etc/passwd` never reaches our guard — the
  // browser collapses it to `/etc/passwd` first. The realistic attack
  // vector is percent-encoded `..` (`%2E%2E`), which survives browser
  // normalisation and is decoded by the router, at which point the
  // guard's `.includes("..")` check catches it.
  const BAD_PATHS: readonly { label: string; url: string }[] = [
    { label: "leading-slash path form (absolute)", url: "/files//etc/passwd" },
    { label: "parent traversal (percent-encoded)", url: "/files/..%2F..%2Fetc%2Fpasswd" },
    { label: "legacy query with traversal", url: "/files?path=../../../etc/passwd" },
    { label: "legacy query with absolute path", url: "/files?path=/etc/passwd" },
  ];

  for (const { label, url } of BAD_PATHS) {
    test(`rejects ${label}`, async ({ page }) => {
      await page.goto(url);
      await expect(page.getByText("MulmoClaude")).toBeVisible();
      await expect(async () => {
        const parsed = new URL(page.url());
        expect(parsed.searchParams.get("path")).toBeNull();
        // Guard redirects to /files (empty pathMatch). Trailing slash
        // variants are both acceptable — `replace:true` with empty
        // array may yield either `/files` or `/files/` depending on
        // how the browser normalises.
        expect(parsed.pathname).toMatch(/^\/files\/?$/);
      }).toPass({ timeout: 5 * ONE_SECOND_MS });
    });
  }
});

// ── Navigation: back/forward preserves state ────────────────────
//
// Selecting one file, then another, must create history entries we
// can step through. `router.push` (not `replace`) is used for
// `selectFile`, so browser Back should restore the previous file.

test("browser back restores the previous file selection", async ({ page }) => {
  await installFileMocks(page, WEIRD_NAMES);

  const first = "artifacts/documents/17c48329.md";
  const second = "notes/café.md";

  await page.goto(buildPathUrl(first));
  await expect(page.getByText(bodyFor(first)).first()).toBeVisible({
    timeout: 5 * ONE_SECOND_MS,
  });

  await page.goto(buildPathUrl(second));
  await expect(page.getByText(bodyFor(second)).first()).toBeVisible({
    timeout: 5 * ONE_SECOND_MS,
  });

  await page.goBack();
  await expect(page.getByText(bodyFor(first)).first()).toBeVisible({
    timeout: 5 * ONE_SECOND_MS,
  });

  await page.goForward();
  await expect(page.getByText(bodyFor(second)).first()).toBeVisible({
    timeout: 5 * ONE_SECOND_MS,
  });
});
