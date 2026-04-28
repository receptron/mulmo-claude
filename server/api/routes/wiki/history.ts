// Wiki page edit-history routes (#763 PR 2). Three endpoints:
//
//   GET  /api/wiki/pages/:slug/history             — list snapshots (meta-only)
//   GET  /api/wiki/pages/:slug/history/:stamp      — read one snapshot
//   POST /api/wiki/pages/:slug/history/:stamp/restore — round-trip the
//     snapshot through `writeWikiPage` (which snapshots the restore
//     itself, so undo stays cheap).
//
// Path safety: both `:slug` and `:stamp` are validated *before*
// they are joined with the workspace root. The slug check matches
// `wiki-pages/io.ts`'s `isSafeSlug`; the stamp check is the
// `FILENAME_RE` shape exposed via `isSafeStamp`.

import { Router, type Request, type Response } from "express";
import path from "node:path";
import { classifyAsWikiPage, writeWikiPage, readWikiPage } from "../../../workspace/wiki-pages/io.js";
import { isSafeStamp, listSnapshots, readSnapshot, stripSnapshotMeta } from "../../../workspace/wiki-pages/snapshot.js";
import { mergeFrontmatter, serializeWithFrontmatter } from "../../../utils/markdown/frontmatter.js";
import { badRequest, notFound } from "../../../utils/httpError.js";
import { readTextOrNull } from "../../../utils/files/safe.js";
import { workspacePath } from "../../../workspace/workspace.js";
import { log } from "../../../system/logger/index.js";

const router = Router();

// Mirrors `isSafeSlug` from wiki-pages/io.ts (kept independent so
// the route layer doesn't import the helper through a circular
// dependency — io.ts already imports snapshot.ts).
function isSafeSlug(slug: string): boolean {
  if (slug.length === 0) return false;
  if (slug === "." || slug === "..") return false;
  if (slug.includes("/") || slug.includes("\\")) return false;
  if (slug.includes("\0")) return false;
  return true;
}

// Restore is a write under the user's workspace; record a short
// reason on the new snapshot so the history reads "Restored from
// 2026-04-28T01-23-45-789Z" rather than an empty cell. Editor stays
// `user` because the human triggered the restore — same shape as
// every other UI-driven save today.
function restoreReason(stamp: string): string {
  return `Restored from ${stamp}`;
}

router.get("/pages/:slug/history", async (req: Request<{ slug: string }>, res: Response) => {
  const { slug } = req.params;
  if (!isSafeSlug(slug)) {
    badRequest(res, "Unsafe slug");
    return;
  }
  // Confirm the page actually exists before exposing its history —
  // otherwise a stray client request for a non-existent slug would
  // get a 200 with `[]` and the caller couldn't tell "no history"
  // from "wrong slug".
  const live = await readWikiPage(slug);
  if (live === null) {
    notFound(res, `wiki page not found: ${slug}`);
    return;
  }
  const snapshots = await listSnapshots(slug);
  res.json({ slug, snapshots });
});

router.get("/pages/:slug/history/:stamp", async (req: Request<{ slug: string; stamp: string }>, res: Response) => {
  const { slug, stamp } = req.params;
  if (!isSafeSlug(slug)) {
    badRequest(res, "Unsafe slug");
    return;
  }
  if (!isSafeStamp(stamp)) {
    badRequest(res, "Unsafe stamp");
    return;
  }
  const snapshot = await readSnapshot(slug, stamp);
  if (snapshot === null) {
    notFound(res, `snapshot not found: ${slug}/${stamp}`);
    return;
  }
  res.json({ slug, snapshot });
});

router.post("/pages/:slug/history/:stamp/restore", async (req: Request<{ slug: string; stamp: string }>, res: Response) => {
  const { slug, stamp } = req.params;
  if (!isSafeSlug(slug)) {
    badRequest(res, "Unsafe slug");
    return;
  }
  if (!isSafeStamp(stamp)) {
    badRequest(res, "Unsafe stamp");
    return;
  }
  const snapshot = await readSnapshot(slug, stamp);
  if (snapshot === null) {
    notFound(res, `snapshot not found: ${slug}/${stamp}`);
    return;
  }

  // Strip `_snapshot_*` keys before writing — they describe the
  // *original* save event and would be misleading on the restored
  // page. `writeWikiPage` will re-stamp `updated` and the new
  // snapshot will get a fresh `_snapshot_ts` for the restore event.
  const liveMeta = stripSnapshotMeta(snapshot.meta);
  const restoredContent = serializeWithFrontmatter(mergeFrontmatter({}, liveMeta), snapshot.body);

  // forceSnapshot=true so a "restore to identical content" still
  // produces an audit entry — without it the no-op gate in
  // writeWikiPage would swallow the restore silently.
  await writeWikiPage(slug, restoredContent, {
    editor: "user",
    reason: restoreReason(stamp),
    forceSnapshot: true,
  });
  log.info("wiki", "history restore", { slug, stamp });
  res.json({ slug, restored: { fromStamp: stamp } });
});

// ── Internal endpoint (LLM write hook callback) ────────────────
//
// Hit by `<workspace>/.claude/hooks/wiki-snapshot.mjs` after the
// claude CLI completes a `Write` / `Edit` tool call. The hook
// passes the absolute path; this handler validates it lives
// under `data/wiki/pages/`, reads the current disk state, and
// drops a snapshot through the same `appendSnapshot` path the
// in-process writers use. Always tagged `editor: "llm"` —
// user-driven writes go through the regular `writeWikiPage`
// path with their own editor identity.
//
// Bearer auth applies via the global `app.use("/api", bearerAuth)`
// in server/index.ts; no extra check needed here.

interface InternalSnapshotBody {
  absPath?: string;
  reason?: string;
  sessionId?: string;
}

router.post("/internal/snapshot", async (req: Request<object, unknown, InternalSnapshotBody>, res: Response) => {
  const { absPath, reason, sessionId } = req.body ?? {};
  if (typeof absPath !== "string" || absPath.length === 0) {
    badRequest(res, "absPath required");
    return;
  }
  // `path.resolve` collapses any embedded `..` segments before we
  // ask `classifyAsWikiPage` whether it lives under the wiki dir.
  // The classifier is path-string-only — it does NOT realpath the
  // input, so the caller MUST already have a normalised absolute
  // path. We accept whatever the LLM hook sent and re-resolve.
  const resolved = path.resolve(absPath);
  const classified = classifyAsWikiPage(resolved);
  if (!classified.wiki) {
    badRequest(res, "absPath is not a wiki page");
    return;
  }

  const content = await readTextOrNull(resolved);
  if (content === null) {
    notFound(res, "wiki page not found on disk");
    return;
  }

  // The hook only fires for claude-CLI-driven writes — by
  // construction the agent is the actor. User-driven manual saves
  // go through writeWikiPage in-process and never reach here.
  const { appendSnapshot } = await import("../../../workspace/wiki-pages/snapshot.js");
  await appendSnapshot(
    classified.slug,
    null,
    content,
    {
      editor: "llm",
      ...(typeof sessionId === "string" && sessionId.length > 0 && { sessionId }),
      ...(typeof reason === "string" && reason.length > 0 && { reason }),
    },
    { workspaceRoot: workspacePath },
  );
  log.info("wiki", "internal snapshot recorded", { slug: classified.slug });
  res.json({ slug: classified.slug, ok: true });
});

export default router;
