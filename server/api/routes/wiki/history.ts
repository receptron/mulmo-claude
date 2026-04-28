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
import { writeWikiPage, readWikiPage } from "../../../workspace/wiki-pages/io.js";
import { isSafeStamp, listSnapshots, readSnapshot, stripSnapshotMeta } from "../../../workspace/wiki-pages/snapshot.js";
import { mergeFrontmatter, serializeWithFrontmatter } from "../../../utils/markdown/frontmatter.js";
import { badRequest, notFound } from "../../../utils/httpError.js";
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

  await writeWikiPage(slug, restoredContent, {
    editor: "user",
    reason: restoreReason(stamp),
  });
  log.info("wiki", "history restore", { slug, stamp });
  res.json({ slug, restored: { fromStamp: stamp } });
});

export default router;
