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
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { makeManageCollectionTool, MAX_UNSELECTIVE_ITEMS, MAX_SCHEMA_ISSUES } from "../../server/agent/mcp-tools/manageCollection.js";
import { mcpTools } from "../../server/agent/mcp-tools/index.js";
import { setFirestoreAccessor } from "@mulmoclaude/core/collection/server";

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
    assert.match(await run({ action: "putItems", slug: "portfolio" }), /`items` is required/);
    assert.match(await run({ action: "putItems", slug: "portfolio", items: [[1]] }), /`items` is required/);
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
    assert.equal(rejected[0].id, "ghost");
    assert.match(rejected[0].problem, /not found/);
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
    assert.match((result.rejected as { problem: string }[])[0].problem, /not a valid record id/);
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

describe("manageCollection — a disconnected backend never looks like missing data", () => {
  const CLOUD = "cloud-notes";

  beforeEach(() => {
    writeSkill(CLOUD, {
      title: "Cloud Notes",
      icon: "cloud",
      storage: { type: "firestore" },
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true, required: true }, note: { type: "string", label: "Note" } },
    });
    setFirestoreAccessor(null); // no remote-host session
  });

  afterEach(() => setFirestoreAccessor(null));

  // Codex (local review): the store throws a distinguishable error, but the
  // layers above catch broadly. Flattening that into "missing" / "malformed
  // file" / "0 records" sends the agent after a data problem that does not
  // exist, and could have it offer to recreate records that are intact.
  it("reports getItems by id as unavailable, not as missing records", async () => {
    const result = await run({ action: "getItems", slug: CLOUD, ids: ["a"] });
    assert.match(result, /connect remote-host/i);
    assert.doesNotMatch(result, /"missing"/, "must not report the record as absent");
  });

  it("reports a merge against an unreachable backend as unavailable, not a malformed file", async () => {
    const result = await run({ action: "putItems", slug: CLOUD, items: [{ id: "a", note: "x" }], mode: "merge" });
    assert.match(result, /connect remote-host/i);
    assert.doesNotMatch(result, /malformed stored file/, "must not blame a file that doesn't exist");
  });

  it("reports the ontology count as unknown rather than zero", async () => {
    const result = await runJson({ action: "getOntology" });
    const collections = result.collections as { slug: string; recordCount: number | null }[];
    const entry = collections.find((candidate) => candidate.slug === CLOUD);
    assert.ok(entry, "the collection is still listed");
    assert.equal(entry.recordCount, null, "unreachable must be null, never 0");
  });
});
