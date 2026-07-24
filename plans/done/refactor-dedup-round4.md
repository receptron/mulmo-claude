# refactor: dedup guarded-update route shell + snapshot sort comparator

Issue: #2160

Final "1 から順に" #4. Two genuine same-file duplications.

- `server/api/routes/mulmo-script.ts` — updateBeat / updateScript were
  identical except for the execute they call. Extract `runGuardedUpdate`
  (both executes share the `(ctx, body) => Promise<UpdateMulmoScriptOutcome>`
  signature).
- `server/workspace/wiki-pages/snapshot.ts` — gcSnapshots / listSnapshots
  repeated the newest-first sort comparator (filenameStamp, then stamp
  tie-break). Extract `compareSnapshotsNewestFirst` — the one ordering rule.

Pure extraction; `test_snapshot.ts` + `test_wikiHistoryRoute.ts` 34/34.

This closes the dedup initiative: the remaining jscpd pairs are cross-file
boundary-constrained, intentional splits (agent/stream), or trivial
init/natural similarity (draft.ts, i18n/vite/spreadsheet) — left as-is per
the DRY principle (similar ≠ knowledge duplication).
