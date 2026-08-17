import "../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
// `manageCollection` MCP tool: getItems returns computed-enriched
// records with ids/fields selection and the unselective-size refusal;
// putItems gates every row on schema validation (and computed-key
// rejection) BEFORE writing, with per-row accept/reject results.
// Exercised against a real tmpdir workspace via the factory's injected
// DiscoveryOptions — no mocking of the collections layer, so the test
// pins the same code paths production runs.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  makeManageCollectionTool,
  MAX_UNSELECTIVE_ITEMS,
  MAX_SCHEMA_ISSUES,
  MAX_PUT_ITEMS,
  MAX_PUT_LINT,
  MAX_ITEMS_FILE_BYTES,
  type PutItemsLint,
} from "../../server/agent/mcp-tools/manageCollection.js";
import { mcpTools } from "../../server/agent/mcp-tools/index.js";

let workdir: string;
let emptyUserDir: string;
let tool: ReturnType<typeof makeManageCollectionTool>;

const quotesSchema = {
  title: "Stock Quotes",
  icon: "trending_up",
  dataPath: "data/stock-quotes/items",
  primaryKey: "symbol",
  fields: {
    symbol: { type: "string", label: "Symbol", primary: true, required: true },
    price: { type: "number", label: "Price" },
  },
};

const portfolioSchema = {
  title: "Portfolio",
  icon: "work",
  dataPath: "data/portfolio/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    name: { type: "string", label: "Name", required: true },
    ticker: { type: "ref", label: "Ticker", to: "stock-quotes" },
    shares: { type: "number", label: "Shares" },
    value: { type: "derived", label: "Value", formula: "shares * ticker.price" },
    status: { type: "enum", label: "Status", values: ["open", "closed"] },
    closed: { type: "toggle", label: "Closed", field: "status", onValue: "closed", offValue: "open" },
    owner: { type: "embed", label: "Owner", to: "profile", id: "me" },
  },
};

const profileSchema = {
  title: "Profile",
  icon: "person",
  dataPath: "data/profile/items",
  primaryKey: "id",
  singleton: "me",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    name: { type: "string", label: "Name" },
  },
};

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "manage-collection-"));
  emptyUserDir = mkdtempSync(path.join(tmpdir(), "manage-collection-user-"));
  tool = makeManageCollectionTool({ workspaceRoot: workdir, userSkillsDir: emptyUserDir });
  writeSkill("stock-quotes", quotesSchema);
  writeSkill("portfolio", portfolioSchema);
  writeSkill("profile", profileSchema);
  writeRecord("data/stock-quotes/items", "aapl", { symbol: "aapl", price: 200 });
  writeRecord("data/profile/items", "me", { id: "me", name: "Satoshi" });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(emptyUserDir, { recursive: true, force: true });
});

function writeSkill(slug: string, schema: object): void {
  const dir = path.join(workdir, ".claude/skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: test fixture\n---\nbody\n`);
  writeFileSync(path.join(dir, "schema.json"), JSON.stringify(schema));
}

function writeRecord(dataPath: string, itemId: string, record: object): void {
  const dir = path.join(workdir, dataPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${itemId}.json`), JSON.stringify(record));
}

const run = (args: Record<string, unknown>) => tool.handler(args);
const runJson = async (args: Record<string, unknown>) => JSON.parse(await run(args)) as Record<string, unknown>;

describe("manageCollection — argument validation", () => {
  it("requires slug and a known action", async () => {
    assert.match(await run({ action: "getItems" }), /`slug` is required/);
    assert.match(await run({ action: "destroy", slug: "portfolio" }), /`action` must be/);
  });

  it("reports an unknown collection", async () => {
    assert.match(await run({ action: "getItems", slug: "nope" }), /unknown collection 'nope'/);
  });

  it("rejects malformed ids / fields / items / mode", async () => {
    assert.match(await run({ action: "getItems", slug: "portfolio", ids: [42] }), /`ids` must be an array/);
    assert.match(await run({ action: "getItems", slug: "portfolio", fields: "name" }), /`fields` must be an array/);
    assert.match(await run({ action: "putItems", slug: "portfolio" }), /putItems needs `items`.*or `itemsFile`/);
    assert.match(await run({ action: "putItems", slug: "portfolio", items: [[1]] }), /putItems needs `items`.*or `itemsFile`/);
    assert.match(await run({ action: "putItems", slug: "portfolio", items: [{ id: "a" }], mode: "replace" }), /`mode` must be/);
  });

  it("is registered as an alwaysActive MCP tool", () => {
    const registered = mcpTools.find((entry) => entry.definition.name === "manageCollection");
    assert.ok(registered, "manageCollection must be in the mcpTools array");
    assert.equal(registered.alwaysActive, true);
  });
});

describe("manageCollection — getItems", () => {
  beforeEach(() => {
    writeRecord("data/portfolio/items", "h1", { id: "h1", name: "Apple", ticker: "aapl", shares: 10, status: "open" });
    writeRecord("data/portfolio/items", "h2", { id: "h2", name: "Cash", status: "closed" });
  });

  it("returns records enriched with derived + toggle values", async () => {
    const result = await runJson({ action: "getItems", slug: "portfolio" });
    assert.equal(result.count, 2);
    const items = result.items as Record<string, unknown>[];
    const apple = items.find((item) => item.id === "h1");
    const cash = items.find((item) => item.id === "h2");
    assert.equal(apple?.value, 2000); // 10 * 200, host-computed
    assert.equal(apple?.closed, false);
    assert.equal(cash?.closed, true);
  });

  it("selects by ids and reports missing ones", async () => {
    const result = await runJson({ action: "getItems", slug: "portfolio", ids: ["h1", "ghost"] });
    assert.equal(result.count, 1);
    assert.deepEqual(result.missing, ["ghost"]);
  });

  it("resolves embed fields to the target record, null when missing", async () => {
    const withProfile = await runJson({ action: "getItems", slug: "portfolio", ids: ["h1"] });
    const [item] = withProfile.items as Record<string, unknown>[];
    assert.deepEqual(item?.owner, { id: "me", name: "Satoshi" });
    rmSync(path.join(workdir, "data/profile/items/me.json"), { force: true });
    const withoutProfile = await runJson({ action: "getItems", slug: "portfolio", ids: ["h1"] });
    const [bare] = withoutProfile.items as Record<string, unknown>[];
    assert.equal(bare?.owner, null);
  });

  it("a stale stored derived value never reaches the result", async () => {
    writeRecord("data/portfolio/items", "h9", { id: "h9", name: "Forged", ticker: "ghost", shares: 10, value: 999, status: "open" });
    const result = await runJson({ action: "getItems", slug: "portfolio", ids: ["h9"] });
    const [item] = result.items as Record<string, unknown>[];
    assert.equal(item?.value, undefined); // formula fails (dangling ref) → absent, not 999
  });

  it("projects fields, always keeping the primary key", async () => {
    const result = await runJson({ action: "getItems", slug: "portfolio", ids: ["h1"], fields: ["value"] });
    const [item] = result.items as Record<string, unknown>[];
    assert.deepEqual(item, { id: "h1", value: 2000 });
  });

  it("appends a defanged warning for malformed record files", async () => {
    writeFileSync(path.join(workdir, "data/portfolio/items/bad.json"), '{ "id": "bad", broken');
    const result = await runJson({ action: "getItems", slug: "portfolio" });
    assert.match(String(result.warning), /bad\.json/);
    assert.match(String(result.warning), /1 record file/);
  });

  it("skips the warning scan on a selective read that found everything", async () => {
    writeFileSync(path.join(workdir, "data/portfolio/items/bad.json"), '{ "id": "bad", broken');
    const found = await runJson({ action: "getItems", slug: "portfolio", ids: ["h1"] });
    assert.equal(found.warning, undefined); // all requested ids present → no full scan
    // A requested id that comes back missing IS explained by the scan.
    const missed = await runJson({ action: "getItems", slug: "portfolio", ids: ["bad"] });
    assert.deepEqual(missed.missing, ["bad"]);
    assert.match(String(missed.warning), /bad\.json/);
  });

  it("refuses an unselective read over the limit, lifted by fields", async () => {
    for (let i = 0; i < MAX_UNSELECTIVE_ITEMS + 1; i++) {
      writeRecord("data/portfolio/items", `r${i}`, { id: `r${i}`, name: `R${i}` });
    }
    assert.match(await run({ action: "getItems", slug: "portfolio" }), /over the unselective limit/);
    const projected = await runJson({ action: "getItems", slug: "portfolio", fields: ["name"] });
    assert.equal(projected.count, MAX_UNSELECTIVE_ITEMS + 3);
  });
});

describe("manageCollection — putItems", () => {
  const record = (itemId: string, extra: Record<string, unknown> = {}) => ({ id: itemId, name: `Name ${itemId}`, status: "open", ...extra });
  const stored = (itemId: string) => JSON.parse(readFileSync(path.join(workdir, `data/portfolio/items/${itemId}.json`), "utf-8")) as Record<string, unknown>;

  it("writes valid rows and rejects invalid rows independently", async () => {
    const result = await runJson({
      action: "putItems",
      slug: "portfolio",
      items: [record("good"), { id: "noname", status: "open" }, record("badenum", { status: "nope" })],
    });
    assert.deepEqual(result.written, ["good"]);
    const rejected = result.rejected as { id: string; problem: string }[];
    assert.equal(rejected.length, 2);
    assert.match(rejected.find((row) => row.id === "noname")?.problem ?? "", /missing required field 'name'/);
    assert.match(rejected.find((row) => row.id === "badenum")?.problem ?? "", /not one of/);
    assert.deepEqual(stored("good"), record("good"));
    assert.ok(!existsSync(path.join(workdir, "data/portfolio/items/noname.json")), "rejected row must not be written");
  });

  it("ablateValidation (evaluation-only) writes rows that validation would reject", async () => {
    const ablated = makeManageCollectionTool({ workspaceRoot: workdir, userSkillsDir: emptyUserDir, ablateValidation: true });
    const result = JSON.parse(
      await ablated.handler({
        action: "putItems",
        slug: "portfolio",
        items: [record("badenum-ablated", { status: "nope" })],
      }),
    ) as Record<string, unknown>;
    assert.deepEqual(result.written, ["badenum-ablated"]);
    assert.deepEqual(result.rejected, []);
    assert.equal(stored("badenum-ablated").status, "nope", "out-of-enum value written verbatim under ablation");
    // getItems under ablation stays silent about the bad stored record
    const listed = JSON.parse(await ablated.handler({ action: "getItems", slug: "portfolio" })) as Record<string, unknown>;
    assert.equal(listed.warning, undefined);
  });

  it("rejects a row with no primaryKey value", async () => {
    const result = await runJson({ action: "putItems", slug: "portfolio", items: [{ name: "No Id", status: "open" }] });
    const [rejectedRow] = result.rejected as { id: string; problem: string }[];
    assert.match(rejectedRow?.problem ?? "", /has no 'id' value/);
  });

  it("rejects computed keys with an actionable pointer", async () => {
    const result = await runJson({
      action: "putItems",
      slug: "portfolio",
      items: [record("a", { value: 999 }), record("b", { closed: true })],
    });
    const rejected = result.rejected as { id: string; problem: string }[];
    assert.match(rejected.find((row) => row.id === "a")?.problem ?? "", /'value' is derived/);
    assert.match(rejected.find((row) => row.id === "b")?.problem ?? "", /write the enum field 'status' instead/);
    assert.deepEqual(result.written, []);
    const embed = await runJson({ action: "putItems", slug: "portfolio", items: [record("c", { owner: { id: "me" } })] });
    assert.match((embed.rejected as { problem: string }[])[0]?.problem ?? "", /'owner' is an embed/);
    writeSkill("quotes-linked", {
      title: "Quotes Linked",
      icon: "trending_up",
      dataPath: "data/quotes-linked/items",
      primaryKey: "symbol",
      fields: {
        symbol: { type: "string", label: "Symbol", primary: true, required: true },
        holders: { type: "backlinks", label: "Holders", from: "portfolio", via: "ticker", display: ["shares"] },
        totalShares: { type: "rollup", label: "Total shares", from: "portfolio", via: "ticker", op: "sum", column: "shares" },
      },
    });
    const backlinks = await runJson({ action: "putItems", slug: "quotes-linked", items: [{ symbol: "x", holders: [] }] });
    assert.match((backlinks.rejected as { problem: string }[])[0]?.problem ?? "", /'holders' is a backlinks view/);
    const rollup = await runJson({ action: "putItems", slug: "quotes-linked", items: [{ symbol: "y", totalShares: 15 }] });
    assert.match((rollup.rejected as { problem: string }[])[0]?.problem ?? "", /'totalShares' is a rollup/);
  });

  it("rejects path-shaped ids before any write", async () => {
    const result = await runJson({ action: "putItems", slug: "portfolio", items: [record("../evil")] });
    const [rejectedRow] = result.rejected as { id: string; problem: string }[];
    assert.match(rejectedRow?.problem ?? "", /not a valid record id/);
  });

  it('mode "create" refuses an existing id; default upsert overwrites', async () => {
    writeRecord("data/portfolio/items", "h1", record("h1"));
    const created = await runJson({ action: "putItems", slug: "portfolio", items: [record("h1")], mode: "create" });
    assert.match((created.rejected as { problem: string }[])[0]?.problem ?? "", /already exists/);
    const upserted = await runJson({ action: "putItems", slug: "portfolio", items: [record("h1", { shares: 5 })] });
    assert.deepEqual(upserted.written, ["h1"]);
    assert.equal(stored("h1").shares, 5);
  });

  it('mode "merge" updates only the carried fields, keeping the rest', async () => {
    writeRecord("data/portfolio/items", "h1", record("h1", { ticker: "aapl", shares: 10, notes: "keep me" }));
    const merged = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "h1", status: "closed" }], mode: "merge" });
    assert.deepEqual(merged.written, ["h1"]);
    // The partial row changed status; everything it omitted survives.
    assert.deepEqual(stored("h1"), record("h1", { ticker: "aapl", shares: 10, notes: "keep me", status: "closed" }));
  });

  it("the same partial row under default upsert documents the hazard merge prevents", async () => {
    // A partial upsert passes validation only when every REQUIRED field
    // is carried — here it isn't, so validation already rejects it. With
    // name carried it would write and erase the optionals; merge is the
    // safe path for partial updates either way.
    writeRecord("data/portfolio/items", "h1", record("h1", { notes: "keep me" }));
    const partial = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "h1", status: "closed" }] });
    assert.match((partial.rejected as { problem: string }[])[0]?.problem ?? "", /missing required field 'name'/);
    assert.equal(stored("h1").notes, "keep me");
  });

  it('mode "merge" rejects an unknown id instead of creating a partial record', async () => {
    const result = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "ghost", status: "open" }], mode: "merge" });
    const [rejectedRow] = result.rejected as { id: string; problem: string }[];
    assert.match(rejectedRow?.problem ?? "", /not found .* use "upsert" or "create"/);
    assert.ok(!existsSync(path.join(workdir, "data/portfolio/items/ghost.json")));
  });

  it('mode "merge" heals a stale computed key in the stored record', async () => {
    // Raw-written/legacy record carrying a forged host-computed value:
    // a merge must not re-write it.
    writeRecord("data/portfolio/items", "h1", record("h1", { value: 999, notes: "keep me" }));
    const merged = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "h1", status: "closed" }], mode: "merge" });
    assert.deepEqual(merged.written, ["h1"]);
    const healed = stored("h1");
    assert.ok(!("value" in healed), "stale derived key must be stripped on merge");
    assert.equal(healed.notes, "keep me");
    assert.equal(healed.status, "closed");
  });

  it('mode "merge" still validates the merged result and rejects computed keys', async () => {
    writeRecord("data/portfolio/items", "h1", record("h1", { notes: "keep me" }));
    const badEnum = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "h1", status: "nope" }], mode: "merge" });
    assert.match((badEnum.rejected as { problem: string }[])[0]?.problem ?? "", /not one of/);
    assert.equal(stored("h1").status, "open"); // untouched
    const computed = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "h1", value: 1 }], mode: "merge" });
    assert.match((computed.rejected as { problem: string }[])[0]?.problem ?? "", /'value' is derived/);
  });

  it('mode "merge" rejects a malformed stored file per-row instead of aborting the batch', async () => {
    // readItem throws on non-ENOENT (broken JSON); merge must downgrade that
    // to a row rejection so the healthy rows in the same batch still write.
    writeRecord("data/portfolio/items", "h1", record("h1", { notes: "keep me" }));
    writeFileSync(path.join(workdir, "data/portfolio/items/bad.json"), '{ "id": "bad", broken');
    const result = await runJson({
      action: "putItems",
      slug: "portfolio",
      items: [
        { id: "bad", status: "closed" },
        { id: "h1", status: "closed" },
      ],
      mode: "merge",
    });
    assert.deepEqual(result.written, ["h1"]);
    const [rejectedRow] = result.rejected as { id: string; problem: string }[];
    assert.equal(rejectedRow?.id, "bad");
    assert.match(rejectedRow?.problem ?? "", /malformed stored file/);
    assert.equal(stored("h1").status, "closed"); // the healthy row landed
  });
});

// The write gate refuses what makes a record unopenable; the SHAPE of a value it
// only reports (`lint-not-lock`, so a collection whose legacy rows predate the
// typed rules stays writable). Before mulmoterminal#1763 it did not report it
// either: 720 slots seeded with `toISOString()` came back as 720 written and
// nothing else, and the app that published from them refused every one.
describe("manageCollection — putItems lint", () => {
  const slot = (itemId: string, startAt: string) => ({ id: itemId, startAt });

  beforeEach(() => {
    writeSkill("slots", {
      title: "Slots",
      icon: "event",
      dataPath: "data/slots/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        startAt: { type: "datetime", label: "Start" },
        note: { type: "string", label: "Note" },
      },
    });
  });

  it("writes a Z-suffixed datetime and says so, naming what a later reader will do about it", async () => {
    const result = await runJson({ action: "putItems", slug: "slots", items: [slot("s1", "2026-08-17T15:00:00.000Z")] });
    assert.deepEqual(result.written, ["s1"], "the row is written — the strict tier reports, it does not refuse");
    assert.deepEqual(result.rejected, []);
    assert.ok(existsSync(path.join(workdir, "data/slots/items/s1.json")));
    const lint = result.lint as PutItemsLint;
    assert.equal(lint.total, 1);
    assert.equal(lint.rows[0]?.id, "s1");
    assert.match(lint.rows[0]?.problem ?? "", /not a YYYY-MM-DDTHH:MM datetime/);
    assert.match(lint.note, /WERE written/);
    assert.match(lint.note, /publishing a shared app REFUSES the row/);
  });

  it("has no lint key at all when every written row fits its types", async () => {
    const result = await runJson({ action: "putItems", slug: "slots", items: [slot("s1", "2026-08-17T08:00")] });
    assert.deepEqual(result.written, ["s1"]);
    assert.equal("lint" in result, false, "absence is the signal — an empty block would read as noise");
  });

  it("reports the true total while showing only the first rows", async () => {
    const rows = Array.from({ length: MAX_PUT_LINT + 2 }, (unused, index) => slot(`s${index}`, "2026-08-17T15:00:00.000Z"));
    const result = await runJson({ action: "putItems", slug: "slots", items: rows });
    const lint = result.lint as PutItemsLint;
    assert.equal((result.written as string[]).length, MAX_PUT_LINT + 2);
    assert.equal(lint.total, MAX_PUT_LINT + 2, "a capped list must never be readable as a total");
    assert.equal(lint.rows.length, MAX_PUT_LINT);
  });

  it("lints only the rows it wrote — a rejected row already has its problem", async () => {
    const result = await runJson({
      action: "putItems",
      slug: "slots",
      items: [slot("s1", "2026-08-17T15:00:00.000Z"), { startAt: "2026-08-17T15:00:00.000Z" }],
    });
    assert.deepEqual(result.written, ["s1"]);
    assert.equal((result.rejected as unknown[]).length, 1);
    const lint = result.lint as PutItemsLint;
    assert.equal(lint.total, 1);
    assert.equal(lint.rows[0]?.id, "s1");
  });

  it("lints the record as WRITTEN, so a merge that leaves a bad value in place still reports it", async () => {
    writeRecord("data/slots/items", "s1", slot("s1", "2026-08-17T15:00:00.000Z"));
    const result = await runJson({ action: "putItems", slug: "slots", items: [{ id: "s1", note: "held" }], mode: "merge" });
    assert.deepEqual(result.written, ["s1"]);
    const lint = result.lint as PutItemsLint;
    assert.match(lint.rows[0]?.problem ?? "", /not a YYYY-MM-DDTHH:MM datetime/, "the merged result is what a later read will lint");
  });

  it("stays silent under ablateValidation, like the rest of the gate", async () => {
    const ablated = makeManageCollectionTool({ workspaceRoot: workdir, userSkillsDir: emptyUserDir, ablateValidation: true });
    const result = JSON.parse(await ablated.handler({ action: "putItems", slug: "slots", items: [slot("s1", "2026-08-17T15:00:00.000Z")] })) as Record<
      string,
      unknown
    >;
    assert.deepEqual(result.written, ["s1"]);
    assert.equal("lint" in result, false);
  });
});

// `itemsFile` exists so a generated set of rows never has to pass through the
// model's context (issue #2914 — the agent hand-spawned the MCP bridge rather
// than write 540 records inline). The failure modes it must NOT have: reading a
// path that resolved somewhere unintended, and writing part of an over-cap file.
describe("manageCollection — putItems from itemsFile", () => {
  const record = (itemId: string, extra: Record<string, unknown> = {}) => ({ id: itemId, name: `Name ${itemId}`, status: "open", ...extra });
  const stored = (itemId: string) => JSON.parse(readFileSync(path.join(workdir, `data/portfolio/items/${itemId}.json`), "utf-8")) as Record<string, unknown>;
  const writeItemsFile = (name: string, rows: unknown): string => {
    const file = path.join(workdir, name);
    writeFileSync(file, JSON.stringify(rows));
    return file;
  };

  it("writes the rows the file holds, with the same per-row results as inline items", async () => {
    const itemsFile = writeItemsFile("rows.json", [record("f1"), { id: "noname", status: "open" }]);
    const result = await runJson({ action: "putItems", slug: "portfolio", itemsFile });
    assert.deepEqual(result.written, ["f1"]);
    assert.match((result.rejected as { problem: string }[])[0]?.problem ?? "", /missing required field 'name'/);
    assert.deepEqual(stored("f1"), record("f1"));
  });

  it("honours mode, so a file can be a create-only batch", async () => {
    const itemsFile = writeItemsFile("dup.json", [record("dup")]);
    assert.deepEqual((await runJson({ action: "putItems", slug: "portfolio", itemsFile, mode: "create" })).written, ["dup"]);
    const again = await runJson({ action: "putItems", slug: "portfolio", itemsFile, mode: "create" });
    assert.deepEqual(again.written, []);
    assert.match((again.rejected as { problem: string }[])[0]?.problem ?? "", /already exists/);
  });

  it("refuses items and itemsFile together rather than picking one", async () => {
    const itemsFile = writeItemsFile("both.json", [record("fromfile")]);
    const result = await run({ action: "putItems", slug: "portfolio", items: [record("inline")], itemsFile });
    assert.match(result, /either `items` or `itemsFile`.*not both/);
    assert.ok(!existsSync(path.join(workdir, "data/portfolio/items/inline.json")), "neither source may be written");
    assert.ok(!existsSync(path.join(workdir, "data/portfolio/items/fromfile.json")), "neither source may be written");
  });

  it("refuses a relative path — the server process's cwd is not the agent's", async () => {
    const result = await run({ action: "putItems", slug: "portfolio", itemsFile: "rows.json" });
    assert.match(result, /must be an ABSOLUTE path/);
  });

  // Unconstrained, this handler would be a host-filesystem read primitive for a
  // sandboxed agent: any JSON array on the host, stored and then read back out
  // with getItems. The workspace is also the only region the sandbox shares.
  it("refuses a path outside the workspace, and a symlink that leaves it", async () => {
    const outside = path.join(emptyUserDir, "elsewhere.json");
    writeFileSync(outside, JSON.stringify([record("smuggled")]));
    assert.match(await run({ action: "putItems", slug: "portfolio", itemsFile: outside }), /must be inside the workspace/);

    const bridge = path.join(workdir, "bridge.json");
    symlinkSync(outside, bridge);
    assert.match(await run({ action: "putItems", slug: "portfolio", itemsFile: bridge }), /must be inside the workspace/);
    assert.ok(!existsSync(path.join(workdir, "data/portfolio/items/smuggled.json")), "nothing outside the workspace may be read in");
  });

  // The containment check and the read must be bound to ONE descriptor. Checking
  // a pathname and reading that pathname again leaves a window in which the
  // agent — which can write anywhere in the workspace — swaps the symlink for
  // one pointing outside, restoring the read primitive containment denies.
  it("refuses a symlink even when it points inside the workspace", async () => {
    const real = writeItemsFile("real.json", [record("linked")]);
    const link = path.join(workdir, "link.json");
    symlinkSync(real, link);
    assert.match(await run({ action: "putItems", slug: "portfolio", itemsFile: link }), /is a symbolic link/);
    assert.ok(!existsSync(path.join(workdir, "data/portfolio/items/linked.json")), "a symlink is never followed, contained or not");
  });

  it("never reads what the path was swapped to mid-call", async () => {
    const outside = path.join(emptyUserDir, "swapped-in.json");
    writeFileSync(outside, JSON.stringify([record("swapped")]));
    const target = writeItemsFile("racy.json", [record("honest")]);

    // Swap the file for a symlink out of the workspace while the call is in
    // flight. Either outcome is safe — the descriptor's own bytes, or a refusal
    // once the swap is noticed — but the swapped-in target must never be read.
    const inFlight = run({ action: "putItems", slug: "portfolio", itemsFile: target });
    rmSync(target, { force: true });
    symlinkSync(outside, target);
    const result = await inFlight;

    assert.ok(!result.includes("swapped"), `the swapped-in target must never be read, got: ${result}`);
    assert.ok(!existsSync(path.join(workdir, "data/portfolio/items/swapped.json")), "the swapped-in target must never be written");
  });

  // A sandboxed agent's absolute paths are CONTAINER paths; the host mounts the
  // workspace elsewhere. Read verbatim they ENOENT on every real host.
  it("translates a sandbox mount prefix back to the workspace root", async () => {
    const sandboxed = makeManageCollectionTool({ workspaceRoot: workdir, userSkillsDir: emptyUserDir, sandboxWorkspacePath: "/home/node/mulmoclaude" });
    writeItemsFile("from-sandbox.json", [record("boxed")]);
    const result = JSON.parse(
      await sandboxed.handler({ action: "putItems", slug: "portfolio", itemsFile: "/home/node/mulmoclaude/from-sandbox.json" }),
    ) as Record<string, unknown>;
    assert.deepEqual(result.written, ["boxed"], "the container path must resolve to the same bytes on the host");
  });

  it("reports an unreadable file, a non-regular file and bad JSON as fixable text, not a throw", async () => {
    assert.match(await run({ action: "putItems", slug: "portfolio", itemsFile: path.join(workdir, "ghost.json") }), /could not read `itemsFile`/);
    assert.match(await run({ action: "putItems", slug: "portfolio", itemsFile: path.join(workdir, "data") }), /is not a regular file/);
    const notJson = path.join(workdir, "bad.json");
    writeFileSync(notJson, "{not json");
    assert.match(await run({ action: "putItems", slug: "portfolio", itemsFile: notJson }), /could not be read as JSON/);
    assert.match(await run({ action: "putItems", slug: "portfolio", itemsFile: writeItemsFile("empty.json", []) }), /non-empty JSON array/);
    assert.match(await run({ action: "putItems", slug: "portfolio", itemsFile: writeItemsFile("scalars.json", [1, 2]) }), /non-empty JSON array/);
  });

  // The row cap cannot bound this: the file is read and parsed WHOLE before
  // there are rows to count, so an oversized blob is paid for in full first.
  it("refuses an oversized file from stat, before reading it", async () => {
    const fat = path.join(workdir, "fat.json");
    writeFileSync(fat, `[${" ".repeat(MAX_ITEMS_FILE_BYTES)}]`);
    assert.match(await run({ action: "putItems", slug: "portfolio", itemsFile: fat }), new RegExp(`over the limit of ${MAX_ITEMS_FILE_BYTES}`));
  });

  // A size check bounds nothing if the read then runs to EOF: appending keeps
  // the same inode, so neither the cap nor the identity check would notice a
  // 2-byte file turning into gigabytes between the stat and the read.
  it("reads no further than the size it checked, when the file grows underneath", async () => {
    const growing = writeItemsFile("growing.json", [record("small")]);
    const inFlight = run({ action: "putItems", slug: "portfolio", itemsFile: growing });
    appendFileSync(growing, " ".repeat(MAX_ITEMS_FILE_BYTES));
    const result = await inFlight;
    // Which gate catches it depends on whether the append lands before the
    // stat or after; all three outcomes are bounded reads. What must never
    // happen is the call taking the grown file as its rows.
    assert.ok(
      /over the limit of/.test(result) || /grew while it was being read/.test(result) || /"written":\["small"\]/.test(result),
      `expected a bounded read, got: ${result}`,
    );
  });

  it("refuses an over-cap file WHOLE, leaving nothing written", async () => {
    const rows = Array.from({ length: MAX_PUT_ITEMS + 1 }, (_unused, index) => record(`cap${index}`));
    const result = await run({ action: "putItems", slug: "portfolio", itemsFile: writeItemsFile("toomany.json", rows) });
    assert.match(result, new RegExp(`over the putItems limit of ${MAX_PUT_ITEMS}`));
    assert.ok(!existsSync(path.join(workdir, "data/portfolio/items/cap0.json")), "an over-cap call must not write its first rows");
  });

  it("applies the same cap to inline items", async () => {
    const items = Array.from({ length: MAX_PUT_ITEMS + 1 }, (_unused, index) => record(`inline${index}`));
    assert.match(await run({ action: "putItems", slug: "portfolio", items }), new RegExp(`over the putItems limit of ${MAX_PUT_ITEMS}`));
  });
});

describe("manageCollection — dotted record ids", () => {
  // A natural key with interior dots (Slack ts) must round-trip through every
  // targeted op, not just the full-scan listing (issue #1735).
  const tsId = "1718900000.123456";

  it("create / get-by-id / merge all accept an interior-dot id", async () => {
    const created = await runJson({ action: "putItems", slug: "stock-quotes", items: [{ symbol: tsId, price: 1 }], mode: "create" });
    assert.deepEqual(created.written, [tsId]);
    assert.ok(existsSync(path.join(workdir, `data/stock-quotes/items/${tsId}.json`)), "record file written under the dotted id");

    const got = await runJson({ action: "getItems", slug: "stock-quotes", ids: [tsId] });
    assert.equal(got.count, 1);
    assert.equal((got.items as Record<string, unknown>[])[0]?.symbol, tsId);
    assert.deepEqual(got.missing ?? [], []);

    const merged = await runJson({ action: "putItems", slug: "stock-quotes", items: [{ symbol: tsId, price: 2 }], mode: "merge" });
    assert.deepEqual(merged.written, [tsId]);
  });

  it("still rejects a `..` id", async () => {
    const result = await runJson({ action: "putItems", slug: "stock-quotes", items: [{ symbol: "a..b", price: 1 }], mode: "create" });
    assert.match((result.rejected as { problem: string }[])[0]?.problem ?? "", /not a valid record id/);
  });
});

describe("manageCollection — getOntology", () => {
  interface OntologyEntry {
    slug: string;
    primaryKey: string;
    displayField: string;
    recordCount: number;
    relations: Record<string, unknown>[];
  }
  const getOntology = async () => (await runJson({ action: "getOntology" })).collections as OntologyEntry[];
  const entryFor = (entries: OntologyEntry[], slug: string) => entries.find((entry) => entry.slug === slug) as OntologyEntry;

  it("needs no slug and lists every discovered collection", async () => {
    const result = await runJson({ action: "getOntology" });
    assert.equal(result.count, 3);
    assert.deepEqual(
      (result.collections as OntologyEntry[]).map((entry) => entry.slug),
      ["portfolio", "profile", "stock-quotes"],
    );
  });

  it("reports outbound ref/embed relations in field declaration order, skipping non-relation fields", async () => {
    const portfolio = entryFor(await getOntology(), "portfolio");
    assert.deepEqual(portfolio.relations, [
      { field: "ticker", kind: "ref", to: "stock-quotes" },
      { field: "owner", kind: "embed", to: "profile" },
    ]);
    assert.deepEqual(entryFor(await getOntology(), "stock-quotes").relations, []);
  });

  it("reports table sub-refs with a dotted field path, and backlinks with their source", async () => {
    writeSkill("invoice", {
      title: "Invoices",
      icon: "receipt",
      dataPath: "data/invoice/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        payments: { type: "backlinks", label: "Payments", from: "portfolio", via: "invoiceId", display: ["shares"] },
        paidTotal: { type: "rollup", label: "Paid", from: "portfolio", via: "invoiceId", op: "sum", column: "shares" },
        lines: { type: "table", label: "Lines", of: { clientId: { type: "ref", label: "Client", to: "portfolio" } } },
      },
    });
    const invoice = entryFor(await getOntology(), "invoice");
    assert.deepEqual(invoice.relations, [
      { field: "payments", kind: "backlinks", to: "portfolio", via: "invoiceId" },
      { field: "paidTotal", kind: "rollup", to: "portfolio", via: "invoiceId" },
      { field: "lines.clientId", kind: "ref", to: "portfolio" },
    ]);
  });

  it("counts record files without parsing them, and falls back displayField to the primaryKey", async () => {
    writeFileSync(path.join(workdir, "data/stock-quotes/items", "broken.json"), "not json {");
    // A symlinked record is unreadable through the collection APIs
    // (listItems' lstat defense skips it), so it must not count either.
    symlinkSync(path.join(workdir, "data/profile/items/me.json"), path.join(workdir, "data/stock-quotes/items", "linked.json"));
    const entries = await getOntology();
    const quotes = entryFor(entries, "stock-quotes");
    assert.equal(quotes.recordCount, 2); // aapl + the malformed file — a summary counts files, not parses; symlink excluded
    assert.equal(quotes.displayField, "symbol");
    assert.equal(entryFor(entries, "portfolio").recordCount, 0);
  });
});

describe("manageCollection — schemaDocs", () => {
  it("returns the bundled authoring reference when the workspace has none", async () => {
    const docs = await run({ action: "schemaDocs" });
    assert.doesNotMatch(docs, /could not read/);
    assert.match(docs, /Collection skills/); // heading from the bundled collection-skills.md
  });

  // The full doc outgrew the agent's per-tool-result limit, so the default
  // reply is the core authoring guide + a table of contents (see
  // @mulmoclaude/core collection/server/schemaDocs.ts for the unit-level
  // rules; these pin the wiring against the real bundled doc).
  it("defaults to the core guide + table of contents, not the full doc", async () => {
    const docs = await run({ action: "schemaDocs" });
    assert.match(docs, /### Field types/, "field DSL served by default");
    assert.match(docs, /Sections \(call schemaDocs/, "table of contents present");
    assert.match(docs, /- Kanban view/, "advanced sections listed in the TOC");
    assert.doesNotMatch(docs, /gains a \*\*Kanban board\*\* toggle/, "advanced section BODIES stay topic-only");
    assert.ok(docs.length < 40_000, `default reply must stay well under the full doc (${docs.length} chars)`);
  });

  // #2312: the agent authored Google Calendar collections with an MCP
  // connector + an `ingest: { kind: "agent" }` worker because the DEFAULT
  // reply — the only part it reads before writing a schema — never named the
  // LLM-free `googleCalendar` block. A mention in a `###` subsection would
  // not fix that: renderDefault serves only the core sections' own prose, so
  // the pointer has to live in the top-level shape table.
  it("names the googleCalendar block in the default reply and routes to its help file", async () => {
    const docs = await run({ action: "schemaDocs" });
    assert.match(docs, /`googleCalendar`/, "the sync block is discoverable without a topic");
    assert.match(docs, /config\/helps\/google-calendar-collection\.md/, "the default reply routes to the full contract");
    assert.match(docs, /- Google Calendar sync \(`googleCalendar`\)/, "the section is listed in the TOC");
  });

  it("serves a single section by topic", async () => {
    const docs = await run({ action: "schemaDocs", topic: "kanban" });
    assert.match(docs, /gains a \*\*Kanban board\*\* toggle/);
    assert.doesNotMatch(docs, /### Field types/);
  });

  it('serves the Google Calendar sync section for topic "google calendar"', async () => {
    const docs = await run({ action: "schemaDocs", topic: "google calendar" });
    assert.match(docs, /### Google Calendar sync \(`googleCalendar`\)/);
    assert.match(docs, /"map": \{ "title": "summary"/, "the block example is included");
    assert.doesNotMatch(docs, /### Field types/, "one section, not the whole doc");
  });

  it('serves the full doc for topic "all"', async () => {
    const docs = await run({ action: "schemaDocs", topic: "all" });
    assert.match(docs, /billing suite/i, "tail of the full doc present");
    assert.ok(docs.length > 60_000, "the whole reference");
  });

  it("reports an unmatched topic and repeats the table of contents", async () => {
    const docs = await run({ action: "schemaDocs", topic: "zebra crossings" });
    assert.match(docs, /no schemaDocs section matches 'zebra crossings'/);
    assert.match(docs, /Sections \(call schemaDocs/);
  });

  it("prefers the workspace copy over the bundled asset", async () => {
    const helpsDir = path.join(workdir, "config/helps");
    mkdirSync(helpsDir, { recursive: true });
    writeFileSync(path.join(helpsDir, "collection-skills.md"), "SENTINEL workspace doc");
    assert.equal(await run({ action: "schemaDocs" }), "SENTINEL workspace doc");
  });

  it("needs no slug", async () => {
    assert.doesNotMatch(await run({ action: "schemaDocs" }), /`slug` is required/);
  });
});

describe("manageCollection — getSchema", () => {
  it("returns the raw schema.json of an existing collection", async () => {
    const parsed = JSON.parse(await run({ action: "getSchema", slug: "portfolio" })) as Record<string, unknown>;
    assert.equal(parsed.title, "Portfolio");
    assert.ok((parsed.fields as Record<string, unknown>).value, "derived field present");
  });

  it("reports an unknown collection", async () => {
    assert.match(await run({ action: "getSchema", slug: "nope" }), /unknown collection 'nope'/);
  });
});

describe("manageCollection — putSchema", () => {
  // Inject a no-op refresh so the write never touches the real workspace.
  let putTool: ReturnType<typeof makeManageCollectionTool>;
  const putRun = (args: Record<string, unknown>) => putTool.handler(args);
  const readJson = (rel: string) => JSON.parse(readFileSync(path.join(workdir, rel), "utf-8")) as Record<string, unknown>;
  const withField = (fields: Record<string, unknown>) => ({ ...quotesSchema, fields: { ...quotesSchema.fields, ...fields } });

  beforeEach(() => {
    putTool = makeManageCollectionTool({ workspaceRoot: workdir, userSkillsDir: emptyUserDir, refreshAfterWrite: async () => {} });
  });

  it("validates, writes to data/skills staging, and mirrors to .claude/skills", async () => {
    const updated = withField({ volume: { type: "number", label: "Volume" } });
    const result = JSON.parse(await putRun({ action: "putSchema", slug: "stock-quotes", schema: updated })) as Record<string, unknown>;
    assert.equal(result.written, true);
    assert.ok((readJson("data/skills/stock-quotes/schema.json").fields as Record<string, unknown>).volume, "new field in canonical staging copy");
    assert.ok((readJson(".claude/skills/stock-quotes/schema.json").fields as Record<string, unknown>).volume, "new field mirrored to active copy");
  });

  it("rejects an invalid schema, points at schemaDocs, and writes nothing", async () => {
    const msg = await putRun({ action: "putSchema", slug: "stock-quotes", schema: { ...quotesSchema, primaryKey: "" } });
    assert.match(msg, /schema rejected/);
    assert.match(msg, /schemaDocs/);
    assert.ok(!existsSync(path.join(workdir, "data/skills/stock-quotes/schema.json")), "no staging file on rejection");
  });

  it("requires a schema object", async () => {
    assert.match(await putRun({ action: "putSchema", slug: "stock-quotes" }), /`schema` is required/);
  });

  it("refuses a user-scope collection (read-only)", async () => {
    const dir = path.join(emptyUserDir, "house-rules");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), "---\nname: house-rules\ndescription: test fixture\n---\nbody\n");
    writeFileSync(path.join(dir, "schema.json"), JSON.stringify(quotesSchema));
    assert.match(await putRun({ action: "putSchema", slug: "house-rules", schema: quotesSchema }), /user-scope and read-only/);
  });

  it("refuses a preset (mc-*) collection", async () => {
    writeSkill("mc-budget", quotesSchema);
    assert.match(await putRun({ action: "putSchema", slug: "mc-budget", schema: quotesSchema }), /preset \(mc-\*\)/);
  });

  it("refuses an unknown collection with a create hint", async () => {
    assert.match(await putRun({ action: "putSchema", slug: "ghost", schema: quotesSchema }), /create it by writing SKILL\.md/);
  });

  // Post-Zod gates discovery applies — a schema that passes CollectionSchemaZ
  // but fails one of these would write cleanly yet vanish on next discovery.
  const noStagingWrite = () => assert.ok(!existsSync(path.join(workdir, "data/skills/stock-quotes/schema.json")), "no staging write on rejection");

  it("rejects a primaryKey that is not a declared field", async () => {
    const bad = { ...quotesSchema, primaryKey: "ghostkey" };
    assert.match(await putRun({ action: "putSchema", slug: "stock-quotes", schema: bad }), /not one of the declared fields/);
    noStagingWrite();
  });

  it("rejects a primaryKey field not flagged primary: true", async () => {
    const bad = { ...quotesSchema, fields: { ...quotesSchema.fields, symbol: { type: "string", label: "Symbol", required: true } } };
    assert.match(await putRun({ action: "putSchema", slug: "stock-quotes", schema: bad }), /must be flagged `primary: true`/);
    noStagingWrite();
  });

  it("rejects a dataPath that escapes the workspace", async () => {
    const bad = { ...quotesSchema, dataPath: "../../etc/evil" };
    assert.match(await putRun({ action: "putSchema", slug: "stock-quotes", schema: bad }), /escapes the workspace/);
    noStagingWrite();
  });

  it("caps the issue list and flags how many were omitted", async () => {
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < MAX_SCHEMA_ISSUES + 5; i++) fields[`f${i}`] = { type: "not-a-real-type", label: `F${i}` };
    const msg = await putRun({ action: "putSchema", slug: "stock-quotes", schema: { ...quotesSchema, fields } });
    const bullets = msg.split("\n").filter((line) => line.startsWith("- "));
    const issueBullets = bullets.filter((line) => !line.includes("…and"));
    assert.equal(issueBullets.length, MAX_SCHEMA_ISSUES, "issue bullets capped at MAX_SCHEMA_ISSUES");
    assert.match(msg, /…and \d+ more issue\(s\)/);
  });
});

describe("manageCollection — deleteItems", () => {
  beforeEach(() => {
    writeRecord("data/portfolio/items", "h1", { id: "h1", name: "Apple", ticker: "aapl", shares: 10, status: "open" });
    writeRecord("data/portfolio/items", "h2", { id: "h2", name: "Cash", status: "closed" });
  });

  const recordPath = (itemId: string) => path.join(workdir, "data/portfolio/items", `${itemId}.json`);

  it("deletes a record and removes its file", async () => {
    const result = await runJson({ action: "deleteItems", slug: "portfolio", ids: ["h1"] });
    assert.deepEqual(result.deleted, ["h1"]);
    assert.deepEqual(result.rejected, []);
    assert.equal(existsSync(recordPath("h1")), false);
    assert.equal(existsSync(recordPath("h2")), true, "unrelated records survive");
  });

  it("deletes several ids in one call", async () => {
    const result = await runJson({ action: "deleteItems", slug: "portfolio", ids: ["h1", "h2"] });
    assert.deepEqual((result.deleted as string[]).sort(), ["h1", "h2"]);
    assert.equal(existsSync(recordPath("h1")), false);
    assert.equal(existsSync(recordPath("h2")), false);
  });

  it("rejects an id that does not exist instead of reporting it deleted", async () => {
    const result = await runJson({ action: "deleteItems", slug: "portfolio", ids: ["ghost"] });
    assert.deepEqual(result.deleted, []);
    const rejected = result.rejected as { id: string; problem: string }[];
    assert.equal(rejected.length, 1);
    const [ghost] = rejected;
    assert.ok(ghost);
    assert.equal(ghost.id, "ghost");
    assert.match(ghost.problem, /not found/);
  });

  it("keeps a partially-bad batch partial — good ids still go", async () => {
    const result = await runJson({ action: "deleteItems", slug: "portfolio", ids: ["h1", "ghost"] });
    assert.deepEqual(result.deleted, ["h1"]);
    assert.equal((result.rejected as unknown[]).length, 1);
    assert.equal(existsSync(recordPath("h1")), false);
  });

  it("rejects a path-traversal id without touching the filesystem", async () => {
    const result = await runJson({ action: "deleteItems", slug: "portfolio", ids: ["../../../etc/passwd"] });
    assert.deepEqual(result.deleted, []);
    const [traversal] = result.rejected as { problem: string }[];
    assert.ok(traversal, "the traversal id must be reported as rejected");
    assert.match(traversal.problem, /not a valid record id/);
    assert.equal(existsSync(recordPath("h1")), true, "nothing else was deleted");
  });

  it("requires a non-empty ids array", async () => {
    assert.match(await run({ action: "deleteItems", slug: "portfolio" }), /`ids` is required for deleteItems/);
    assert.match(await run({ action: "deleteItems", slug: "portfolio", ids: [] }), /`ids` is required for deleteItems/);
    assert.match(await run({ action: "deleteItems", slug: "portfolio", ids: [42] }), /`ids` is required for deleteItems/);
    assert.match(await run({ action: "deleteItems", slug: "portfolio", ids: ["  "] }), /`ids` is required for deleteItems/);
  });

  it("refuses a read-only dataSource collection", async () => {
    writeSkill("students", {
      title: "Students",
      icon: "school",
      dataSource: { type: "csv", path: "data/students.csv" },
      primaryKey: "student_id",
      fields: { student_id: { type: "string", label: "ID", primary: true }, name: { type: "string", label: "Name" } },
    });
    mkdirSync(path.join(workdir, "data"), { recursive: true });
    writeFileSync(path.join(workdir, "data/students.csv"), "student_id,name\ns1,Ada\n");
    assert.match(await run({ action: "deleteItems", slug: "students", ids: ["s1"] }), /read-only/);
  });
});

// Field-level `default` (#2839): a starting value for a NEW record, so the
// same two values don't have to be typed on every add.
describe("manageCollection — enum field defaults", () => {
  const TASKS = {
    title: "Tasks",
    icon: "task_alt",
    dataPath: "data/tasks/items",
    primaryKey: "id",
    fields: {
      id: { type: "string", label: "ID", primary: true, required: true },
      title: { type: "string", label: "Title", required: true },
      status: { type: "enum", label: "Status", values: ["todo", "doing", "done"], required: true, default: "todo" },
      priority: { type: "enum", label: "Priority", values: ["high", "low"], default: "low" },
    },
  };
  const storedTask = (itemId: string) => JSON.parse(readFileSync(path.join(workdir, `data/tasks/items/${itemId}.json`), "utf-8")) as Record<string, unknown>;

  beforeEach(() => writeSkill("tasks", TASKS));

  it("fills the fields a create row omits, satisfying a required enum on its own", async () => {
    const result = await runJson({ action: "putItems", slug: "tasks", items: [{ id: "t1", title: "Write it" }], mode: "create" });
    assert.deepEqual(result.rejected, []);
    assert.equal(storedTask("t1").status, "todo");
    assert.equal(storedTask("t1").priority, "low");
  });

  // An `enum` is a legal primary key (`primary` lives on every field type), so
  // a default can be what supplies the record id — which means the merge has to
  // happen before the id is resolved, not after (Codex review on #2910).
  it("supplies the id when the primary key is an enum with a default", async () => {
    writeSkill("phases", {
      title: "Phases",
      icon: "list",
      dataPath: "data/phases/items",
      primaryKey: "phase",
      fields: {
        phase: { type: "enum", label: "Phase", values: ["intake", "review"], primary: true, required: true, default: "intake" },
        note: { type: "string", label: "Note" },
      },
    });
    const result = await runJson({ action: "putItems", slug: "phases", items: [{ note: "no id given" }], mode: "create" });
    assert.deepEqual(result.rejected, []);
    assert.deepEqual(result.written, ["intake"]);
    const stored = JSON.parse(readFileSync(path.join(workdir, "data/phases/items/intake.json"), "utf-8")) as Record<string, unknown>;
    assert.equal(stored.phase, "intake");
  });

  it("never overrides a value the row carries", async () => {
    await runJson({ action: "putItems", slug: "tasks", items: [{ id: "t2", title: "Urgent", status: "doing", priority: "high" }], mode: "create" });
    assert.equal(storedTask("t2").status, "doing");
    assert.equal(storedTask("t2").priority, "high");
  });

  // An edit is not a create: the record already answered this question, and
  // re-applying the default would put the answer back to the starting value.
  it("does not apply on upsert or merge", async () => {
    await runJson({ action: "putItems", slug: "tasks", items: [{ id: "t3", title: "Done one", status: "done", priority: "high" }], mode: "create" });

    const merged = await runJson({ action: "putItems", slug: "tasks", items: [{ id: "t3", title: "Renamed" }], mode: "merge" });
    assert.deepEqual(merged.rejected, []);
    assert.equal(storedTask("t3").status, "done", "merge must keep the stored answer");
    assert.equal(storedTask("t3").priority, "high");

    const upserted = await runJson({ action: "putItems", slug: "tasks", items: [{ id: "t3", title: "Replaced", status: "doing" }] });
    assert.deepEqual(upserted.rejected, []);
    assert.equal(storedTask("t3").status, "doing");
    assert.equal(storedTask("t3").priority, undefined, "upsert replaces WHOLE — no default sneaks back in");
  });
});

describe("manageCollection — putSchema and a stale default", () => {
  let putTool: ReturnType<typeof makeManageCollectionTool>;
  const putRun = (args: Record<string, unknown>) => putTool.handler(args);
  const withStatus = (status: Record<string, unknown>) => ({
    title: "Tasks",
    icon: "task_alt",
    dataPath: "data/tasks/items",
    primaryKey: "id",
    fields: { id: { type: "string", label: "ID", primary: true, required: true }, status },
  });

  beforeEach(() => {
    putTool = makeManageCollectionTool({ workspaceRoot: workdir, userSkillsDir: emptyUserDir, refreshAfterWrite: async () => {} });
    writeSkill("tasks", withStatus({ type: "enum", label: "Status", values: ["todo", "done"] }));
  });

  it("accepts a default that is one of the values", async () => {
    const schema = withStatus({ type: "enum", label: "Status", values: ["todo", "done"], default: "todo" });
    const result = JSON.parse(await putRun({ action: "putSchema", slug: "tasks", schema })) as Record<string, unknown>;
    assert.equal(result.written, true);
  });

  it("refuses a default the values do not offer, naming what was allowed", async () => {
    const schema = withStatus({ type: "enum", label: "Status", values: ["todo", "done"], default: "未着手" });
    const msg = await putRun({ action: "putSchema", slug: "tasks", schema });
    assert.match(msg, /schema rejected/);
    assert.match(msg, /未着手/);
    assert.match(msg, /todo, done/);
    assert.ok(!existsSync(path.join(workdir, "data/skills/tasks/schema.json")), "no staging file on rejection");
  });

  // The compatibility guarantee. `default` was silently ignored before #2839,
  // so a file may already carry one the values no longer offer. Refusing it at
  // PARSE time would drop the collection out of discovery's index entirely —
  // the collection would vanish from the UI with only a log line. It must keep
  // loading, and simply start blank.
  it("keeps loading a collection whose stored default is not a member", async () => {
    writeSkill("tasks", withStatus({ type: "enum", label: "Status", values: ["todo", "done"], default: "未着手" }));
    const created = await runJson({ action: "putItems", slug: "tasks", items: [{ id: "t9" }], mode: "create" });
    assert.deepEqual(created.rejected, [], "the collection is still discoverable and writable");
    const stored = JSON.parse(readFileSync(path.join(workdir, "data/tasks/items/t9.json"), "utf-8")) as Record<string, unknown>;
    assert.equal(stored.status, undefined, "an impossible default is not handed to the record");
  });
});
