// Loader for the `page-edit` wiki action (Stage 3a, #963). Returns
// the full markdown content (frontmatter + body) for an LLM-edit
// inline preview. Tries the snapshot file first; falls back to the
// live page if the snapshot has been gc'd; reports `deleted` when
// neither survives.

import { apiGet } from "../../utils/api";
import { pluginEndpoints } from "../api";
import type { WikiEndpoints } from "./index";
import { serializeWithFrontmatter } from "@mulmoclaude/markdown-utils/markdown/frontmatter";

export type PageEditLoadResult =
  { kind: "snapshot"; content: string; ts: string } | { kind: "current"; content: string } | { kind: "deleted" } | { kind: "error" };

// A network failure (status 0) or a 5xx is transient — the page may well
// exist. Reporting it as "deleted" is a factual lie the user can't recover
// from without a manual reload.
export const isTransientStatus = (status: number): boolean => status === 0 || status >= 500;

const NOT_FOUND_STATUS = 404;

// When neither the snapshot nor the live page yielded content, decide whether
// that's a fetch problem (report "error", recoverable) or a genuine deletion.
// Only NOT-FOUND semantics prove a deletion: an explicit 404, or a live fetch
// that succeeded and reported no page. Every other failure — 401, 403, 429, a
// 5xx, a dropped connection — says nothing about whether the page still
// exists, and calling it "deleted" is a lie the user cannot recover from.
export const classifyLoadFailure = (snapStatus: number, current: { ok: boolean; status: number }): "error" | "deleted" => {
  if (isTransientStatus(snapStatus)) return "error";
  if (current.ok || current.status === NOT_FOUND_STATUS) return "deleted";
  return "error";
};

interface SnapshotResponse {
  snapshot: {
    body: string;
    meta: Record<string, unknown>;
    ts: string;
  };
}

interface CurrentPageResponse {
  data: {
    content?: string;
    pageExists?: boolean;
  };
}

/** Fetch the snapshot at `(slug, stamp)`; on 404 fall through to
 *  the live page (`pagePath` lives at `data/wiki/pages/<slug>.md`
 *  by convention, but the slug already encodes that — pagePath is
 *  carried along as audit metadata). */
export async function loadPageEdit(slug: string, stamp: string): Promise<PageEditLoadResult> {
  const wikiEndpoints = pluginEndpoints<WikiEndpoints>("wiki");
  const snap = await apiGet<SnapshotResponse>(`${wikiEndpoints.base}/pages/${encodeURIComponent(slug)}/history/${encodeURIComponent(stamp)}`);
  if (snap.ok) {
    const { body, meta, ts } = snap.data.snapshot;
    return { kind: "snapshot", content: serializeWithFrontmatter(meta, body), ts };
  }

  // Snapshot missing (gc'd → 404) or unreachable (transient) — try the live
  // page. If it has content, show that; otherwise distinguish a transient
  // outage from a genuine deletion.
  const current = await apiGet<CurrentPageResponse>(`${wikiEndpoints.base}?slug=${encodeURIComponent(slug)}`);
  if (current.ok && current.data.data.pageExists === true && typeof current.data.data.content === "string") {
    return { kind: "current", content: current.data.data.content };
  }
  // `status` only exists on the ApiResult failure branch; a successful-but-
  // empty response (page exists:false) is a genuine deletion, not transient.
  const currentStatus = current.ok ? 200 : current.status;
  return { kind: classifyLoadFailure(snap.status, { ok: current.ok, status: currentStatus }) };
}
