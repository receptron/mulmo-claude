// On-disk shapes for the per-session chat summaries cached under
// workspace/chat/index/. These power the title + summary shown for
// past sessions in the sidebar history pane. The full design lives
// in plans/done/feat-session-index-titles.md.

export interface SummaryResult {
  // <= 60 chars in the source language
  title: string;
  // <= 200 chars in the source language
  summary: string;
  // 5-10 short lowercase keywords
  keywords: string[];
}

// One cached summary per session. Written to chat/index/<id>.json
// and also mirrored into manifest.json for bulk-read from the
// /api/sessions route.
export interface ChatIndexEntry {
  id: string;
  roleId: string;
  startedAt: string;
  // ISO timestamp of when this summary was produced. Used by the
  // freshness throttle — we skip re-summarizing a session whose
  // existing entry is less than MIN_INDEX_INTERVAL_MS old, so a
  // 20-turn conversation over 30 min summarizes ~twice, not 20
  // times. See `isFresh` in indexer.ts.
  indexedAt: string;
  title: string;
  summary: string;
  keywords: string[];
}

export interface ChatIndexManifest {
  version: 1;
  // Sorted newest-first by startedAt so the sidebar gets them in
  // display order without a second sort pass.
  entries: ChatIndexEntry[];
}
