import { describe, it, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ensureBookDir, appendJournal, invalidateAllSnapshots, readSnapshot } from "../../server/utils/files/accounting-io.js";
import { balancesAtEndOf, getOrBuildSnapshot, rebuildAllSnapshots } from "../../server/accounting/snapshotCache.js";
import { makeEntry } from "../../server/accounting/journal.js";

const created: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmo-acct-snap-"));
  created.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

async function seed(root: string): Promise<void> {
  await ensureBookDir("default", root);
  // Three months, mixed activity.
  await appendJournal(
    "default",
    makeEntry({
      date: "2026-01-15",
      lines: [
        { accountCode: "1000", debit: 1000 },
        { accountCode: "3000", credit: 1000 },
      ],
      kind: "opening",
    }),
    root,
  );
  await appendJournal(
    "default",
    makeEntry({
      date: "2026-02-10",
      lines: [
        { accountCode: "1000", credit: 200 },
        { accountCode: "5000", debit: 200 },
      ],
    }),
    root,
  );
  await appendJournal(
    "default",
    makeEntry({
      date: "2026-03-05",
      lines: [
        { accountCode: "1100", debit: 500 },
        { accountCode: "4000", credit: 500 },
      ],
    }),
    root,
  );
}

function balancesEqual(lhs: { accountCode: string; netDebit: number }[], rhs: { accountCode: string; netDebit: number }[]): boolean {
  if (lhs.length !== rhs.length) return false;
  const byCode = new Map(rhs.map((row) => [row.accountCode, row.netDebit]));
  for (const row of lhs) {
    const other = byCode.get(row.accountCode);
    if (other === undefined) return false;
    if (Math.abs(row.netDebit - other) > 0.0001) return false;
  }
  return true;
}

describe("snapshot cache byte-equality invariant", () => {
  it("getOrBuildSnapshot result == balancesAtEndOf result for every period", async () => {
    const root = makeTmp();
    await seed(root);
    for (const period of ["2026-01", "2026-02", "2026-03"]) {
      const cached = await getOrBuildSnapshot("default", period, root);
      const fromJournal = await balancesAtEndOf("default", period, root);
      assert.ok(balancesEqual(cached.balances, fromJournal), `period ${period} should match`);
    }
  });
  it("survives full invalidation: rebuild from scratch yields the same numbers", async () => {
    const root = makeTmp();
    await seed(root);
    const snapBefore = await getOrBuildSnapshot("default", "2026-03", root);
    const wiped = await invalidateAllSnapshots("default", root);
    assert.deepEqual(wiped.removed.sort(), ["2026-01", "2026-02", "2026-03"]);
    assert.equal(await readSnapshot("default", "2026-03", root), null);
    const snapAfter = await getOrBuildSnapshot("default", "2026-03", root);
    assert.ok(balancesEqual(snapBefore.balances, snapAfter.balances));
  });
  it("rebuildAllSnapshots produces a snapshot for every journal period", async () => {
    const root = makeTmp();
    await seed(root);
    const result = await rebuildAllSnapshots("default", root);
    assert.deepEqual(result.rebuilt, ["2026-01", "2026-02", "2026-03"]);
    for (const period of result.rebuilt) {
      assert.ok((await readSnapshot("default", period, root)) !== null);
    }
  });
});
