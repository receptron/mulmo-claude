export interface ChatIndexEntry {
  id: string;
  roleId: string;
  startedAt: string;
  // sha256 of the source jsonl content at the time it was last
  // indexed. The indexer skips a session whose current sha matches
  // this — it is the staleness check.
  sourceSha256: string;
  sourceLines: number;
  indexedAt: string;
  // Summary fields produced by claude.
  title: string;
  summary: string;
  keywords: string[];
}

export interface ChatIndexManifest {
  version: 1;
  // Sorted newest-first by startedAt.
  entries: ChatIndexEntry[];
}

export interface SummaryResult {
  title: string;
  summary: string;
  keywords: string[];
}
