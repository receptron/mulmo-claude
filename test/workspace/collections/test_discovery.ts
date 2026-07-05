import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
// Schema validation + field-type tests for the collections discovery
// module. Locks in: (1) the v0 supported field-type set, (2) the
// rejection of unknown types and structurally malformed schemas,
// (3) the primaryKey-must-be-flagged-primary check from PR-1483
// review round 1.
//
// Drives the live `discoverCollections` against a `mkdtempSync` tree
// by supplying `workspaceRoot` + `userSkillsDir` overrides — same
// pattern as `server/workspace/skills/catalog.ts` tests.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoverCollections, loadCollection } from "@mulmoclaude/core/collection/server";

let workdir: string;
let emptyUserDir: string;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "collections-discovery-"));
  // Empty stand-in for ~/.claude/skills/ so the user-scope scan
  // doesn't read real skills into our assertions. The directory
  // exists but contains nothing.
  emptyUserDir = mkdtempSync(path.join(tmpdir(), "collections-discovery-user-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(emptyUserDir, { recursive: true, force: true });
});

function writeSkill(slug: string, schema: object | string | null): void {
  const dir = path.join(workdir, ".claude/skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: test fixture\n---\nbody\n`);
  if (schema !== null) {
    const body = typeof schema === "string" ? schema : JSON.stringify(schema);
    writeFileSync(path.join(dir, "schema.json"), body);
  }
}

async function listCollections() {
  return discoverCollections({ workspaceRoot: workdir, userSkillsDir: emptyUserDir });
}

describe("discoverCollections — field-type support", () => {
  it("accepts a schema using every v0 field type, including boolean", async () => {
    writeSkill("test-allfields", {
      title: "All Fields",
      icon: "category",
      dataPath: "data/all/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name" },
        bio: { type: "text", label: "Bio" },
        email: { type: "email", label: "Email" },
        age: { type: "number", label: "Age" },
        joined: { type: "date", label: "Joined" },
        active: { type: "boolean", label: "Active" },
        notes: { type: "markdown", label: "Notes" },
        photo: { type: "image", label: "Photo" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.slug, "test-allfields");
    assert.equal(collections[0]?.schema.fields.active?.type, "boolean");
    assert.equal(collections[0]?.schema.fields.photo?.type, "image");
  });

  it("accepts a schema using `ref` with a non-empty `to` (added in feat-collections-ref-field)", async () => {
    writeSkill("test-ref-ok", {
      title: "Worklog-like",
      icon: "link",
      dataPath: "data/refok/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        clientId: { type: "ref", to: "mc-clients", label: "Client", required: true },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.fields.clientId?.type, "ref");
    assert.equal(collections[0]?.schema.fields.clientId?.to, "mc-clients");
  });

  it("rejects a schema with `ref` but no `to`", async () => {
    writeSkill("test-ref-bad", {
      title: "Broken Ref",
      icon: "link",
      dataPath: "data/refbad/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        clientId: { type: "ref", label: "Client" }, // missing `to`
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "schema with type:ref but no `to` must be skipped");
  });

  // Codex P2 review on PR #1495: `to` must be a real slug, not
  // any non-empty string. Without this guard, values like
  // `"../escape"` or `"mc-clients/extra"` produced malformed
  // `/collections/${field.to}` router targets and behavior
  // mismatches versus the URI-encoded API fetch path.

  it("rejects a schema whose `ref.to` contains path traversal", async () => {
    writeSkill("test-ref-traversal", {
      title: "Traversal Ref",
      icon: "warning",
      dataPath: "data/reftrav/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        clientId: { type: "ref", to: "../escape", label: "Client" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects a schema whose `ref.to` contains a path separator", async () => {
    writeSkill("test-ref-slash", {
      title: "Slash Ref",
      icon: "warning",
      dataPath: "data/refslash/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        clientId: { type: "ref", to: "mc-clients/extra", label: "Client" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects a schema whose `ref.to` is whitespace", async () => {
    writeSkill("test-ref-ws", {
      title: "Whitespace Ref",
      icon: "warning",
      dataPath: "data/refws/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        clientId: { type: "ref", to: "  ", label: "Client" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects a schema with an unknown field type", async () => {
    writeSkill("test-unknown-type", {
      title: "Unknown",
      icon: "warning",
      dataPath: "data/unknown/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        weird: { type: "geocoord", label: "Geo" }, // not in v0 enum
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  // ─── money / enum / table / derived (feat-mc-invoice PR) ───

  it("accepts a schema using `money` with an explicit currency", async () => {
    writeSkill("test-money", {
      title: "Money",
      icon: "payments",
      dataPath: "data/money/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        rateUsd: { type: "money", currency: "USD", label: "Rate USD" },
        rateJpy: { type: "money", currency: "JPY", label: "Rate JPY" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.fields.rateUsd?.currency, "USD");
    assert.equal(collections[0]?.schema.fields.rateJpy?.currency, "JPY");
  });

  it("rejects `money` with neither `currency` nor `currencyField`", async () => {
    writeSkill("test-money-no-currency", {
      title: "Money",
      icon: "payments",
      dataPath: "data/moneynocur/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        rate: { type: "money", label: "Rate" }, // no `currency` and no `currencyField`
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "money field with no currency source must be skipped");
  });

  it("accepts `money` with a `currencyField` and no literal `currency`", async () => {
    writeSkill("test-money-currencyfield", {
      title: "Money",
      icon: "payments",
      dataPath: "data/moneycurfield/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        currency: { type: "enum", values: ["USD", "JPY"], label: "Currency", required: true },
        rate: { type: "money", currencyField: "currency", label: "Rate" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.fields.rate?.currencyField, "currency");
    assert.equal(collections[0]?.schema.fields.rate?.currency, undefined);
  });

  it("accepts `derived` displayed as money with a `currencyField`", async () => {
    writeSkill("test-derived-currencyfield", {
      title: "Derived Currency Field",
      icon: "calculate",
      dataPath: "data/derivedcurfield/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        currency: { type: "enum", values: ["USD", "JPY"], label: "Currency", required: true },
        total: { type: "derived", label: "Total", formula: "1 + 1", display: "money", currencyField: "currency" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.fields.total?.currencyField, "currency");
  });

  it("rejects a `currencyField` that names a non-existent field", async () => {
    writeSkill("test-currencyfield-typo", {
      title: "Typo Currency Field",
      icon: "warning",
      dataPath: "data/curfieldtypo/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        currency: { type: "enum", values: ["USD", "JPY"], label: "Currency", required: true },
        rate: { type: "money", currencyField: "curreny", label: "Rate" }, // typo: no such field
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "a currencyField pointing at a missing field must be skipped");
  });

  it("rejects a `currencyField` that points at a non-code field", async () => {
    writeSkill("test-currencyfield-wrongtype", {
      title: "Wrong-type Currency Field",
      icon: "warning",
      dataPath: "data/curfieldwrong/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        amount: { type: "number", label: "Amount" },
        rate: { type: "money", currencyField: "amount", label: "Rate" }, // points at a number, not a code field
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "a currencyField pointing at a non-code field must be skipped");
  });

  it("rejects `money` with an empty `currency` string", async () => {
    writeSkill("test-money-bad", {
      title: "Money",
      icon: "payments",
      dataPath: "data/moneybad/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        rate: { type: "money", currency: "", label: "Rate" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("accepts `enum` with a non-empty values array", async () => {
    writeSkill("test-enum", {
      title: "Enum",
      icon: "list",
      dataPath: "data/enum/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        status: { type: "enum", values: ["draft", "sent", "paid", "void"], label: "Status", required: true },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.deepEqual(collections[0]?.schema.fields.status?.values, ["draft", "sent", "paid", "void"]);
  });

  it("rejects `enum` with no values", async () => {
    writeSkill("test-enum-empty", {
      title: "Enum",
      icon: "warning",
      dataPath: "data/enumempty/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        status: { type: "enum", label: "Status" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects `enum` with an empty values array", async () => {
    writeSkill("test-enum-empty-arr", {
      title: "Enum",
      icon: "warning",
      dataPath: "data/enumarr/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        status: { type: "enum", values: [], label: "Status" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("accepts `table` with a non-empty `of` sub-schema", async () => {
    writeSkill("test-table", {
      title: "Invoice-like",
      icon: "receipt",
      dataPath: "data/table/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        lineItems: {
          type: "table",
          label: "Line items",
          of: {
            description: { type: "string", label: "Description", required: true },
            quantity: { type: "number", label: "Qty", required: true },
            rate: { type: "money", currency: "USD", label: "Rate", required: true },
          },
        },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.fields.lineItems?.type, "table");
    assert.equal(collections[0]?.schema.fields.lineItems?.of?.quantity?.type, "number");
  });

  it("rejects a `table` whose money sub-field has no currency source", async () => {
    writeSkill("test-table-money-no-currency", {
      title: "Bad Table Money",
      icon: "warning",
      dataPath: "data/tabmoneynocur/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        lineItems: {
          type: "table",
          label: "Line items",
          of: {
            description: { type: "string", label: "Description", required: true },
            rate: { type: "money", label: "Rate", required: true }, // no `currency` and no `currencyField`
          },
        },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "table money sub-field with no currency source must be skipped");
  });

  it("accepts a `table` money sub-field that uses `currencyField`", async () => {
    writeSkill("test-table-money-currencyfield", {
      title: "Invoice-like",
      icon: "receipt",
      dataPath: "data/tabmoneycurfield/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        currency: { type: "enum", values: ["USD", "JPY"], label: "Currency", required: true },
        lineItems: {
          type: "table",
          label: "Line items",
          of: {
            description: { type: "string", label: "Description", required: true },
            rate: { type: "money", currencyField: "currency", label: "Rate", required: true },
          },
        },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.fields.lineItems?.of?.rate?.currencyField, "currency");
  });

  it("rejects `table` with no `of`", async () => {
    writeSkill("test-table-no-of", {
      title: "Bad Table",
      icon: "warning",
      dataPath: "data/tabnoof/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        rows: { type: "table", label: "Rows" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects nested tables (v0 disallows table inside a table)", async () => {
    writeSkill("test-table-nested", {
      title: "Nested Table",
      icon: "warning",
      dataPath: "data/tabnested/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        outer: {
          type: "table",
          label: "Outer",
          of: {
            inner: { type: "table", label: "Inner", of: { x: { type: "string", label: "X" } } },
          },
        },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "nested table must be rejected at the sub-schema level");
  });

  it("rejects `derived` columns inside a table (v0 disallows)", async () => {
    writeSkill("test-table-derived-col", {
      title: "Derived in Table",
      icon: "warning",
      dataPath: "data/tabderivedcol/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        rows: {
          type: "table",
          label: "Rows",
          of: {
            amount: { type: "derived", label: "Amount", formula: "1" },
          },
        },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("accepts `derived` with a non-empty formula", async () => {
    writeSkill("test-derived", {
      title: "Derived",
      icon: "calculate",
      dataPath: "data/derived/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        subtotal: { type: "derived", label: "Subtotal", formula: "sum(lineItems[].quantity * lineItems[].rate)", display: "money", currency: "USD" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.fields.subtotal?.formula, "sum(lineItems[].quantity * lineItems[].rate)");
    assert.equal(collections[0]?.schema.fields.subtotal?.display, "money");
  });

  it("rejects `derived` with no formula", async () => {
    writeSkill("test-derived-no-formula", {
      title: "Bad Derived",
      icon: "warning",
      dataPath: "data/derivednoform/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        total: { type: "derived", label: "Total" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects `derived` displayed as money but with no `currency`", async () => {
    writeSkill("test-derived-money-no-currency", {
      title: "Bad Derived Money",
      icon: "warning",
      dataPath: "data/derivedmoneynocur/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        total: { type: "derived", label: "Total", formula: "1 + 1", display: "money" }, // missing `currency`
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "derived field displayed as money without `currency` must be skipped");
  });

  it("accepts `derived` with a non-money display and no `currency`", async () => {
    writeSkill("test-derived-number", {
      title: "Derived Number",
      icon: "calculate",
      dataPath: "data/derivednum/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        count: { type: "derived", label: "Count", formula: "1 + 1", display: "number" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1, "a derived field not displayed as money needs no currency");
    assert.equal(collections[0]?.schema.fields.count?.display, "number");
  });

  // ─── embed (feat-collections-embed PR) ───

  it("accepts `embed` with a valid `to` and non-empty `id`", async () => {
    writeSkill("test-embed", {
      title: "Invoice-like",
      icon: "receipt",
      dataPath: "data/embed/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        issuer: { type: "embed", to: "mc-profile", id: "me", label: "From (issuer)" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.fields.issuer?.type, "embed");
    assert.equal(collections[0]?.schema.fields.issuer?.to, "mc-profile");
    assert.equal(collections[0]?.schema.fields.issuer?.id, "me");
  });

  it("rejects `embed` with no `to`", async () => {
    writeSkill("test-embed-no-to", {
      title: "Bad Embed",
      icon: "warning",
      dataPath: "data/embednoto/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        issuer: { type: "embed", id: "me", label: "Issuer" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "embed without `to` must be skipped");
  });

  it("rejects `embed` with no `id`", async () => {
    writeSkill("test-embed-no-id", {
      title: "Bad Embed",
      icon: "warning",
      dataPath: "data/embednoid/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        issuer: { type: "embed", to: "mc-profile", label: "Issuer" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "embed without `id` must be skipped");
  });

  it("rejects `embed` whose `to` contains path traversal", async () => {
    writeSkill("test-embed-traversal", {
      title: "Traversal Embed",
      icon: "warning",
      dataPath: "data/embedtrav/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        issuer: { type: "embed", to: "../escape", id: "me", label: "Issuer" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  // ─── embed per-record target via `idField` ───

  it("accepts `embed` with a valid `to` and an `idField` naming a real field", async () => {
    writeSkill("test-embed-idfield", {
      title: "Multi-issuer Invoice",
      icon: "receipt",
      dataPath: "data/embedidfield/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        issuerId: { type: "ref", to: "mc-profile", label: "Issuer", required: true },
        issuer: { type: "embed", to: "mc-profile", idField: "issuerId", label: "From (issuer)" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.fields.issuer?.idField, "issuerId");
  });

  it("rejects `embed` that declares both `id` and `idField`", async () => {
    writeSkill("test-embed-both", {
      title: "Bad Embed",
      icon: "warning",
      dataPath: "data/embedboth/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        issuerId: { type: "ref", to: "mc-profile", label: "Issuer" },
        issuer: { type: "embed", to: "mc-profile", id: "me", idField: "issuerId", label: "Issuer" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "embed with both `id` and `idField` must be skipped");
  });

  it("rejects `embed` whose `idField` names a non-existent field", async () => {
    writeSkill("test-embed-idfield-missing", {
      title: "Bad Embed",
      icon: "warning",
      dataPath: "data/embedidfieldmissing/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        issuer: { type: "embed", to: "mc-profile", idField: "nope", label: "Issuer" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "embed whose `idField` names no field must be skipped");
  });

  it("rejects `embed` whose `idField` names a non-`ref`/`string` field", async () => {
    // The editor writes the picked id into `idField`, so it must be a field
    // that holds a plain id — a `number` (or table/derived/embed) can't
    // round-trip, so the schema is rejected at load.
    writeSkill("test-embed-idfield-badtype", {
      title: "Bad Embed",
      icon: "warning",
      dataPath: "data/embedidfieldbadtype/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        issuerNum: { type: "number", label: "Issuer #" },
        issuer: { type: "embed", to: "mc-profile", idField: "issuerNum", label: "Issuer" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "embed whose `idField` is not a ref/string must be skipped");
  });
});

describe("discoverCollections — structural validation", () => {
  it("rejects a schema whose primaryKey field is not flagged primary: true", async () => {
    writeSkill("test-missing-primary-flag", {
      title: "Missing Flag",
      icon: "warning",
      dataPath: "data/missing/items",
      primaryKey: "id",
      fields: {
        // Note: no `primary: true` — discovery must reject this
        // since the CollectionView disable-on-edit check is
        // `field.primary === true`.
        id: { type: "string", label: "ID", required: true },
        name: { type: "string", label: "Name" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects a schema whose primaryKey doesn't name a declared field", async () => {
    writeSkill("test-orphan-primary", {
      title: "Orphan",
      icon: "warning",
      dataPath: "data/orphan/items",
      primaryKey: "nonexistent",
      fields: {
        id: { type: "string", label: "ID", primary: true },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects a schema whose dataPath escapes the workspace", async () => {
    writeSkill("test-escape", {
      title: "Escape",
      icon: "warning",
      dataPath: "../../etc",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects malformed JSON in schema.json", async () => {
    writeSkill("test-bad-json", "{ not valid json");
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("ignores skills that ship no schema.json (they're regular skills)", async () => {
    writeSkill("test-no-schema", null);
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects a schema whose displayField doesn't name a declared field", async () => {
    writeSkill("test-orphan-displayfield", {
      title: "Orphan Display",
      icon: "warning",
      dataPath: "data/orphan-display/items",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
      displayField: "nonexistent",
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("accepts a schema whose displayField names a declared field", async () => {
    writeSkill("test-valid-displayfield", {
      title: "Valid Display",
      icon: "check_circle",
      dataPath: "data/valid-display/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true },
        name: { type: "string", label: "Name" },
      },
      displayField: "name",
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.displayField, "name");
  });
});

describe("discoverCollections — singleton", () => {
  it("accepts a schema declaring a `singleton` id", async () => {
    writeSkill("test-singleton", {
      title: "Profile-like",
      icon: "badge",
      dataPath: "data/singleton/items",
      primaryKey: "id",
      singleton: "me",
      fields: { id: { type: "string", label: "ID", primary: true, required: true } },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.singleton, "me");
  });

  it("rejects a `singleton` containing a path separator", async () => {
    writeSkill("test-singleton-bad", {
      title: "Bad Singleton",
      icon: "warning",
      dataPath: "data/singletonbad/items",
      primaryKey: "id",
      singleton: "../escape",
      fields: { id: { type: "string", label: "ID", primary: true, required: true } },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });
});

describe("discoverCollections — actions", () => {
  const fields = { id: { type: "string", label: "ID", primary: true, required: true } };

  it("accepts a schema with a valid chat action", async () => {
    writeSkill("test-actions", {
      title: "Invoice-like",
      icon: "receipt",
      dataPath: "data/actions/items",
      primaryKey: "id",
      fields,
      actions: [{ id: "pdf", label: "Generate PDF", icon: "picture_as_pdf", kind: "chat", role: "accounting", template: "templates/invoice.md" }],
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.actions?.[0]?.id, "pdf");
    assert.equal(collections[0]?.schema.actions?.[0]?.role, "accounting");
    assert.equal(collections[0]?.schema.actions?.[0]?.template, "templates/invoice.md");
  });

  it("rejects an action missing required fields (role)", async () => {
    writeSkill("test-actions-no-role", {
      title: "X",
      icon: "warning",
      dataPath: "data/actnorole/items",
      primaryKey: "id",
      fields,
      actions: [{ id: "pdf", label: "Generate PDF", kind: "chat", template: "templates/invoice.md" }],
    });
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects an unknown action kind", async () => {
    writeSkill("test-actions-bad-kind", {
      title: "X",
      icon: "warning",
      dataPath: "data/actkind/items",
      primaryKey: "id",
      fields,
      actions: [{ id: "pdf", label: "PDF", kind: "mutate", role: "accounting", template: "templates/invoice.md" }],
    });
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects an action template with path traversal", async () => {
    writeSkill("test-actions-traversal", {
      title: "X",
      icon: "warning",
      dataPath: "data/acttrav/items",
      primaryKey: "id",
      fields,
      actions: [{ id: "pdf", label: "PDF", kind: "chat", role: "accounting", template: "../../etc/passwd" }],
    });
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects an action template not under templates/", async () => {
    // The template path must live under `templates/` — this is the
    // exact contract the skill-bridge hook mirrors, so a bare or
    // sibling-dir path can't validate here yet fail to cross the gate
    // (Codex review on PR #1518).
    writeSkill("test-actions-bare-template", {
      title: "X",
      icon: "warning",
      dataPath: "data/actbare/items",
      primaryKey: "id",
      fields,
      actions: [{ id: "pdf", label: "PDF", kind: "chat", role: "accounting", template: "invoice.md" }],
    });
    assert.equal((await listCollections()).length, 0);
  });

  it("accepts an action template nested under templates/", async () => {
    writeSkill("test-actions-nested-template", {
      title: "X",
      icon: "receipt",
      dataPath: "data/actnest/items",
      primaryKey: "id",
      fields,
      actions: [{ id: "mail", label: "Send mail", kind: "chat", role: "accounting", template: "templates/mail/welcome.md" }],
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.actions?.[0]?.template, "templates/mail/welcome.md");
  });

  it("rejects duplicate action ids", async () => {
    writeSkill("test-actions-dup", {
      title: "X",
      icon: "warning",
      dataPath: "data/actdup/items",
      primaryKey: "id",
      fields,
      actions: [
        { id: "pdf", label: "A", kind: "chat", role: "accounting", template: "templates/a.md" },
        { id: "pdf", label: "B", kind: "chat", role: "accounting", template: "templates/b.md" },
      ],
    });
    assert.equal((await listCollections()).length, 0);
  });

  it("accepts an action with a valid `when` predicate", async () => {
    writeSkill("test-actions-when", {
      title: "X",
      icon: "receipt",
      dataPath: "data/actwhen/items",
      primaryKey: "id",
      fields,
      actions: [
        { id: "sale", label: "Record sale", kind: "chat", role: "accounting", template: "templates/s.md", when: { field: "status", in: ["sent", "paid"] } },
      ],
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.deepEqual(collections[0]?.schema.actions?.[0]?.when, { field: "status", in: ["sent", "paid"] });
  });

  it("rejects a `when` missing `field`", async () => {
    writeSkill("test-actions-when-nofield", {
      title: "X",
      icon: "warning",
      dataPath: "data/actwhennf/items",
      primaryKey: "id",
      fields,
      actions: [{ id: "sale", label: "Record sale", kind: "chat", role: "accounting", template: "templates/s.md", when: { in: ["sent"] } }],
    });
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a `when` whose `in` is empty", async () => {
    writeSkill("test-actions-when-emptyin", {
      title: "X",
      icon: "warning",
      dataPath: "data/actwhenei/items",
      primaryKey: "id",
      fields,
      actions: [{ id: "sale", label: "Record sale", kind: "chat", role: "accounting", template: "templates/s.md", when: { field: "status", in: [] } }],
    });
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a `when` whose `in` is not an array", async () => {
    writeSkill("test-actions-when-notarray", {
      title: "X",
      icon: "warning",
      dataPath: "data/actwhenna/items",
      primaryKey: "id",
      fields,
      actions: [{ id: "sale", label: "Record sale", kind: "chat", role: "accounting", template: "templates/s.md", when: { field: "status", in: "sent" } }],
    });
    assert.equal((await listCollections()).length, 0);
  });
});

describe('discoverCollections — agent ingest (`ingest.kind: "agent"`)', () => {
  const fields = { id: { type: "string", label: "ID", primary: true, required: true } };

  it("accepts a valid agent ingest block", async () => {
    writeSkill("test-agent-ingest", {
      title: "Quotes",
      icon: "trending_up",
      dataPath: "data/quotes/items",
      primaryKey: "id",
      fields,
      ingest: { kind: "agent", schedule: "daily", role: "investor", template: "templates/refresh.md" },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.ingest?.kind, "agent");
    assert.equal(collections[0]?.schema.ingest?.role, "investor");
    assert.equal(collections[0]?.schema.ingest?.template, "templates/refresh.md");
  });

  it("accepts an agent ingest with a UTC atHour anchor", async () => {
    writeSkill("test-agent-athour", {
      title: "Quotes",
      icon: "trending_up",
      dataPath: "data/athour/items",
      primaryKey: "id",
      fields,
      ingest: { kind: "agent", schedule: "daily", atHour: 13, role: "investor", template: "templates/refresh.md" },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.ingest?.atHour, 13);
  });

  it("rejects an agent ingest missing role", async () => {
    writeSkill("test-agent-no-role", {
      title: "X",
      icon: "warning",
      dataPath: "data/agnorole/items",
      primaryKey: "id",
      fields,
      ingest: { kind: "agent", schedule: "daily", template: "templates/refresh.md" },
    });
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects an agent ingest template with path traversal", async () => {
    writeSkill("test-agent-traversal", {
      title: "X",
      icon: "warning",
      dataPath: "data/agtrav/items",
      primaryKey: "id",
      fields,
      ingest: { kind: "agent", schedule: "daily", role: "investor", template: "../../etc/passwd" },
    });
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects an agent ingest template not under templates/", async () => {
    writeSkill("test-agent-bare-template", {
      title: "X",
      icon: "warning",
      dataPath: "data/agbare/items",
      primaryKey: "id",
      fields,
      ingest: { kind: "agent", schedule: "daily", role: "investor", template: "refresh.md" },
    });
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects an atHour outside 0–23", async () => {
    writeSkill("test-agent-bad-athour", {
      title: "X",
      icon: "warning",
      dataPath: "data/agbadhour/items",
      primaryKey: "id",
      fields,
      ingest: { kind: "agent", schedule: "daily", atHour: 24, role: "investor", template: "templates/refresh.md" },
    });
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects an unknown ingest kind", async () => {
    writeSkill("test-ingest-bad-kind", {
      title: "X",
      icon: "warning",
      dataPath: "data/badkind/items",
      primaryKey: "id",
      fields,
      ingest: { kind: "telepathy", schedule: "daily", role: "investor", template: "templates/refresh.md" },
    });
    assert.equal((await listCollections()).length, 0);
  });
});

describe("discoverCollections — field visibility (`when`)", () => {
  it("accepts a field with a valid `when` predicate naming a sibling field", async () => {
    writeSkill("test-field-when", {
      title: "Restaurants",
      icon: "restaurant",
      dataPath: "data/restaurants/items",
      primaryKey: "name",
      fields: {
        name: { type: "string", label: "Name", primary: true, required: true },
        visited: { type: "boolean", label: "Visited" },
        rating: { type: "number", label: "Rating", when: { field: "visited", in: ["true"] } },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.deepEqual(collections[0]?.schema.fields.rating?.when, { field: "visited", in: ["true"] });
  });

  it("rejects a field whose `when.field` names a non-existent field", async () => {
    writeSkill("test-field-when-missing", {
      title: "X",
      icon: "warning",
      dataPath: "data/fieldwhenmiss/items",
      primaryKey: "name",
      fields: {
        name: { type: "string", label: "Name", primary: true, required: true },
        rating: { type: "number", label: "Rating", when: { field: "visted", in: ["true"] } }, // typo: no `visted` field
      },
    });
    assert.equal((await listCollections()).length, 0, "a field whose when.field points at a missing field must be skipped");
  });

  it("rejects a field `when` whose `in` is empty", async () => {
    writeSkill("test-field-when-emptyin", {
      title: "X",
      icon: "warning",
      dataPath: "data/fieldwhenei/items",
      primaryKey: "name",
      fields: {
        name: { type: "string", label: "Name", primary: true, required: true },
        visited: { type: "boolean", label: "Visited" },
        rating: { type: "number", label: "Rating", when: { field: "visited", in: [] } },
      },
    });
    assert.equal((await listCollections()).length, 0);
  });
});

describe("discoverCollections — workspaceRoot propagation", () => {
  it("roots each app's dataDir at the supplied workspaceRoot, not the live workspace", async () => {
    // Regression for PR #1489 Codex P1: discovery used to pass
    // `workspaceRoot` through to `.claude/skills/` scanning but
    // call `resolveDataDir` with no arg, so dataDir resolved
    // against the real `~/mulmoclaude/` and broke test isolation.
    writeSkill("test-rooting", {
      title: "Rooting",
      icon: "anchor",
      dataPath: "data/rooting/items",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    const dataDir = collections[0]?.dataDir;
    assert.ok(dataDir, "dataDir should be set");
    assert.ok(dataDir.startsWith(`${workdir}${path.sep}`), `dataDir ${dataDir} should live under workdir ${workdir}`);
  });
});

describe("discoverCollections — triggerField + spawn validation", () => {
  // A valid time-trigger + spawn base, cloned + mutated per case.
  function recurringSchema(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      title: "Rent",
      icon: "home",
      dataPath: "data/rent/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        dueOn: { type: "date", label: "Due", required: true },
        amount: { type: "number", label: "Amount" },
        status: { type: "enum", values: ["pending", "paid"], label: "Status", required: true },
      },
      completionField: "status",
      completionDoneValues: ["paid"],
      triggerField: "dueOn",
      spawn: { when: { field: "status", in: ["paid"] }, every: { unit: "month", interval: 1, dayOfMonth: 10 }, carry: ["amount"], set: { status: "pending" } },
      ...extra,
    };
  }

  it("accepts a well-formed time-trigger + spawn schema", async () => {
    writeSkill("test-rent-ok", recurringSchema());
    assert.equal((await listCollections()).length, 1);
  });

  it("rejects triggerField without the completion pair", async () => {
    writeSkill("test-trigger-no-completion", recurringSchema({ completionField: undefined, completionDoneValues: undefined, spawn: undefined }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects triggerField naming a non-date field", async () => {
    writeSkill("test-trigger-non-date", recurringSchema({ triggerField: "status", spawn: undefined }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects triggerField naming a missing field", async () => {
    writeSkill("test-trigger-missing", recurringSchema({ triggerField: "nope", spawn: undefined }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects spawn without triggerField", async () => {
    writeSkill("test-spawn-no-trigger", recurringSchema({ triggerField: undefined }));
    assert.equal((await listCollections()).length, 0);
  });

  it("accepts a non-negative triggerLeadDays", async () => {
    writeSkill("test-lead-ok", recurringSchema({ triggerLeadDays: 10, spawn: undefined }));
    assert.equal((await listCollections()).length, 1);
  });

  it("rejects triggerLeadDays without triggerField", async () => {
    writeSkill("test-lead-no-trigger", recurringSchema({ triggerField: undefined, triggerLeadDays: 10, spawn: undefined }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a negative triggerLeadDays", async () => {
    writeSkill("test-lead-negative", recurringSchema({ triggerLeadDays: -5, spawn: undefined }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a bad spawn.every (interval < 1)", async () => {
    writeSkill("test-spawn-bad-interval", recurringSchema({ spawn: { every: { unit: "month", interval: 0 } } }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a bad spawn.every (dayOfMonth out of range)", async () => {
    writeSkill("test-spawn-bad-dom", recurringSchema({ spawn: { every: { unit: "month", interval: 1, dayOfMonth: 32 } } }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects spawn.carry naming a missing field", async () => {
    writeSkill("test-spawn-bad-carry", recurringSchema({ spawn: { every: { unit: "month", interval: 1 }, carry: ["ghost"] } }));
    assert.equal((await listCollections()).length, 0);
  });

  it("accepts the 'last' dayOfMonth sentinel", async () => {
    writeSkill("test-spawn-last", recurringSchema({ spawn: { every: { unit: "month", interval: 1, dayOfMonth: "last" } } }));
    assert.equal((await listCollections()).length, 1);
  });

  it("rejects a default-when spawn that `set`s the completion field to a done value (would respawn forever)", async () => {
    writeSkill("test-spawn-respawn-set", recurringSchema({ spawn: { every: { unit: "month", interval: 1 }, set: { status: "paid" } } }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a spawn that carries its own predicate field (successor inherits the matching value)", async () => {
    writeSkill(
      "test-spawn-carry-pred",
      recurringSchema({ spawn: { when: { field: "status", in: ["paid"] }, every: { unit: "month", interval: 1 }, carry: ["status"] } }),
    );
    assert.equal((await listCollections()).length, 0);
  });
});

describe("discoverCollections — field-driven spawn.every validation", () => {
  // A bills collection whose recurrence interval is chosen per-record by the
  // `frequency` enum. Base is well-formed (frequency is an enum, the map
  // covers its values exactly, and frequency is carried onto the successor).
  function freqSchema(spawnEvery: unknown = undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const every = spawnEvery ?? {
      fromField: "frequency",
      map: {
        daily: { unit: "day", interval: 1 },
        weekly: { unit: "week", interval: 1 },
        monthly: { unit: "month", interval: 1, dayOfMonth: 1 },
      },
    };
    return {
      title: "Bills",
      icon: "receipt",
      dataPath: "data/bills/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        dueOn: { type: "date", label: "Due", required: true },
        amount: { type: "number", label: "Amount" },
        frequency: { type: "enum", values: ["daily", "weekly", "monthly"], label: "Frequency", required: true },
        status: { type: "enum", values: ["pending", "paid"], label: "Status", required: true },
      },
      completionField: "status",
      completionDoneValues: ["paid"],
      triggerField: "dueOn",
      spawn: { when: { field: "status", in: ["paid"] }, every, carry: ["amount", "frequency"], set: { status: "pending" } },
      ...extra,
    };
  }

  it("accepts a well-formed field-driven spawn (enum field, exact map, carried)", async () => {
    writeSkill("test-freq-ok", freqSchema());
    assert.equal((await listCollections()).length, 1);
  });

  it("rejects fromField that is not an enum field", async () => {
    writeSkill("test-freq-non-enum", freqSchema({ fromField: "amount", map: { daily: { unit: "day", interval: 1 } } }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects fromField naming a missing field", async () => {
    writeSkill("test-freq-missing", freqSchema({ fromField: "ghost", map: { daily: { unit: "day", interval: 1 } } }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a map that misses an enum value", async () => {
    // `monthly` is a value of `frequency` but absent from the map.
    writeSkill(
      "test-freq-missing-key",
      freqSchema({ fromField: "frequency", map: { daily: { unit: "day", interval: 1 }, weekly: { unit: "week", interval: 1 } } }),
    );
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a map with an extra key not in the enum", async () => {
    writeSkill(
      "test-freq-extra-key",
      freqSchema({
        fromField: "frequency",
        map: {
          daily: { unit: "day", interval: 1 },
          weekly: { unit: "week", interval: 1 },
          monthly: { unit: "month", interval: 1 },
          yearly: { unit: "year", interval: 1 },
        },
      }),
    );
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects when fromField is not carried (and not set) onto the successor", async () => {
    writeSkill(
      "test-freq-not-carried",
      freqSchema(undefined, {
        spawn: {
          when: { field: "status", in: ["paid"] },
          every: {
            fromField: "frequency",
            map: { daily: { unit: "day", interval: 1 }, weekly: { unit: "week", interval: 1 }, monthly: { unit: "month", interval: 1, dayOfMonth: 1 } },
          },
          carry: ["amount"],
          set: { status: "pending" },
        },
      }),
    );
    assert.equal((await listCollections()).length, 0);
  });

  it("accepts when fromField is written by `set` instead of carried", async () => {
    writeSkill(
      "test-freq-set-driver",
      freqSchema(undefined, {
        spawn: {
          when: { field: "status", in: ["paid"] },
          every: {
            fromField: "frequency",
            map: { daily: { unit: "day", interval: 1 }, weekly: { unit: "week", interval: 1 }, monthly: { unit: "month", interval: 1, dayOfMonth: 1 } },
          },
          carry: ["amount"],
          set: { status: "pending", frequency: "monthly" },
        },
      }),
    );
    assert.equal((await listCollections()).length, 1);
  });

  it("rejects when `set` writes fromField to a value not present in the map", async () => {
    // `yearly` isn't a map key, so the successor would be born with an
    // unresolvable driver and the chain would silently halt after one step.
    writeSkill(
      "test-freq-set-unmapped",
      freqSchema(undefined, {
        spawn: {
          when: { field: "status", in: ["paid"] },
          every: {
            fromField: "frequency",
            map: { daily: { unit: "day", interval: 1 }, weekly: { unit: "week", interval: 1 }, monthly: { unit: "month", interval: 1, dayOfMonth: 1 } },
          },
          carry: ["amount"],
          set: { status: "pending", frequency: "yearly" },
        },
      }),
    );
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects when `set` writes fromField to an empty value", async () => {
    writeSkill(
      "test-freq-set-empty",
      freqSchema(undefined, {
        spawn: {
          when: { field: "status", in: ["paid"] },
          every: {
            fromField: "frequency",
            map: { daily: { unit: "day", interval: 1 }, weekly: { unit: "week", interval: 1 }, monthly: { unit: "month", interval: 1, dayOfMonth: 1 } },
          },
          carry: ["amount"],
          set: { status: "pending", frequency: "" },
        },
      }),
    );
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects an `every` carrying BOTH unit and fromField (strict union)", async () => {
    writeSkill("test-freq-both", freqSchema({ unit: "month", interval: 1, fromField: "frequency", map: { daily: { unit: "day", interval: 1 } } }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects an `every` carrying NEITHER unit nor fromField (strict union)", async () => {
    writeSkill("test-freq-neither", freqSchema({ map: { daily: { unit: "day", interval: 1 } } }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a bad interval inside a map value", async () => {
    writeSkill(
      "test-freq-bad-map-interval",
      freqSchema({
        fromField: "frequency",
        map: { daily: { unit: "day", interval: 0 }, weekly: { unit: "week", interval: 1 }, monthly: { unit: "month", interval: 1 } },
      }),
    );
    assert.equal((await listCollections()).length, 0);
  });
});

describe("discoverCollections — calendarField + calendarEndField validation", () => {
  // A collection with two date fields, cloned + mutated per case.
  function calendarSchema(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      title: "Events",
      icon: "event",
      dataPath: "data/events/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name", required: true },
        on: { type: "date", label: "Date", required: true },
        until: { type: "date", label: "End" },
      },
      ...extra,
    };
  }

  it("accepts a schema with no calendar keys (toggle auto-derives from the date field)", async () => {
    writeSkill("test-cal-none", calendarSchema());
    assert.equal((await listCollections()).length, 1);
  });

  it("accepts a valid calendarField + calendarEndField", async () => {
    writeSkill("test-cal-ok", calendarSchema({ calendarField: "on", calendarEndField: "until" }));
    assert.equal((await listCollections()).length, 1);
  });

  it("accepts calendarField alone", async () => {
    writeSkill("test-cal-anchor-only", calendarSchema({ calendarField: "on" }));
    assert.equal((await listCollections()).length, 1);
  });

  it("rejects calendarField naming a non-date field", async () => {
    writeSkill("test-cal-non-date", calendarSchema({ calendarField: "name" }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects calendarField naming a missing field", async () => {
    writeSkill("test-cal-missing", calendarSchema({ calendarField: "nope" }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects calendarEndField without calendarField", async () => {
    writeSkill("test-cal-end-no-anchor", calendarSchema({ calendarEndField: "until" }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects calendarEndField naming a non-date field", async () => {
    writeSkill("test-cal-end-non-date", calendarSchema({ calendarField: "on", calendarEndField: "name" }));
    assert.equal((await listCollections()).length, 0);
  });
});

describe("discoverCollections — kanbanField validation", () => {
  // A collection with an enum field, cloned + mutated per case.
  function kanbanSchema(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      title: "Tasks",
      icon: "checklist",
      dataPath: "data/tasks/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name", required: true },
        status: { type: "enum", label: "Status", values: ["Todo", "Done"] },
      },
      ...extra,
    };
  }

  it("accepts a schema with no kanbanField (toggle auto-derives from the enum field)", async () => {
    writeSkill("test-kanban-none", kanbanSchema());
    assert.equal((await listCollections()).length, 1);
  });

  it("accepts a valid kanbanField and preserves it through parsing", async () => {
    writeSkill("test-kanban-ok", kanbanSchema({ kanbanField: "status" }));
    const collection = await loadCollection("test-kanban-ok", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.equal(collection?.schema.kanbanField, "status");
  });

  it("rejects kanbanField naming a non-enum field", async () => {
    writeSkill("test-kanban-non-enum", kanbanSchema({ kanbanField: "name" }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects kanbanField naming a missing field", async () => {
    writeSkill("test-kanban-missing", kanbanSchema({ kanbanField: "nope" }));
    assert.equal((await listCollections()).length, 0);
  });
});

describe("discoverCollections — toggle field validation", () => {
  // A collection with an enum `status` field and a `done` toggle projecting
  // it, cloned + mutated per case.
  function toggleSchema(doneField: Record<string, unknown>): Record<string, unknown> {
    return {
      title: "Tasks",
      icon: "checklist",
      dataPath: "data/tasks/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name", required: true },
        status: { type: "enum", label: "Status", values: ["Todo", "Done"] },
        done: { type: "toggle", label: "Done", ...doneField },
      },
    };
  }

  it("accepts a valid toggle and preserves it through parsing", async () => {
    writeSkill("test-toggle-ok", toggleSchema({ field: "status", onValue: "Done", offValue: "Todo" }));
    const collection = await loadCollection("test-toggle-ok", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.equal(collection?.schema.fields.done?.type, "toggle");
    assert.equal(collection?.schema.fields.done?.field, "status");
    assert.equal(collection?.schema.fields.done?.onValue, "Done");
  });

  it("rejects a toggle missing field/onValue/offValue", async () => {
    writeSkill("test-toggle-incomplete", toggleSchema({ field: "status" }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a toggle whose field names a non-enum field", async () => {
    writeSkill("test-toggle-non-enum", toggleSchema({ field: "name", onValue: "Done", offValue: "Todo" }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a toggle whose field names a missing field", async () => {
    writeSkill("test-toggle-missing-field", toggleSchema({ field: "nope", onValue: "Done", offValue: "Todo" }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a toggle whose onValue is not one of the enum's values", async () => {
    writeSkill("test-toggle-bad-value", toggleSchema({ field: "status", onValue: "Finished", offValue: "Todo" }));
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects a toggle whose offValue is not one of the enum's values", async () => {
    writeSkill("test-toggle-bad-off-value", toggleSchema({ field: "status", onValue: "Done", offValue: "Finished" }));
    assert.equal((await listCollections()).length, 0);
  });
});

describe("discoverCollections — notifyWhen validation", () => {
  function notifySchema(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      title: "Todos",
      icon: "check_circle",
      dataPath: "data/todos/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        priority: { type: "enum", label: "Priority", values: ["low", "high"] },
        status: { type: "enum", label: "Status", values: ["Todo", "Done"], required: true },
      },
      completionField: "status",
      completionDoneValues: ["Done"],
      ...extra,
    };
  }

  it("accepts a valid notifyWhen and preserves it through parsing", async () => {
    writeSkill("test-notify-ok", notifySchema({ notifyWhen: { field: "priority", in: ["high"] } }));
    const collection = await loadCollection("test-notify-ok", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.deepEqual(collection?.schema.notifyWhen, { field: "priority", in: ["high"] });
  });

  it("rejects notifyWhen without completionField", async () => {
    writeSkill(
      "test-notify-no-completion",
      notifySchema({ completionField: undefined, completionDoneValues: undefined, notifyWhen: { field: "priority", in: ["high"] } }),
    );
    assert.equal((await listCollections()).length, 0);
  });

  it("rejects notifyWhen naming a missing field", async () => {
    writeSkill("test-notify-missing-field", notifySchema({ notifyWhen: { field: "nope", in: ["high"] } }));
    assert.equal((await listCollections()).length, 0);
  });
});

describe("loadCollection", () => {
  it("returns the named project-scope collection", async () => {
    writeSkill("test-load", {
      title: "Loadable",
      icon: "download",
      dataPath: "data/load/items",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
    });
    const collection = await loadCollection("test-load", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.notEqual(collection, null);
    assert.equal(collection?.slug, "test-load");
    assert.equal(collection?.source, "project");
  });

  it("returns null for an invalid slug", async () => {
    const collection = await loadCollection("../escape", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.equal(collection, null);
  });

  it("returns null when the named collection does not exist", async () => {
    const collection = await loadCollection("nope", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.equal(collection, null);
  });
});

describe("discoverCollections — defaultSort", () => {
  const baseFields = {
    id: { type: "string", label: "ID", primary: true, required: true },
    status: { type: "enum", label: "Status", values: ["red", "green"] },
    notes: { type: "markdown", label: "Notes" },
  };

  it("accepts a defaultSort naming a sortable field", async () => {
    writeSkill("test-sort-ok", {
      title: "Sortable",
      icon: "sort",
      dataPath: "data/sortok/items",
      primaryKey: "id",
      fields: baseFields,
      defaultSort: { field: "status", direction: "asc" },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.deepEqual(collections[0]?.schema.defaultSort, { field: "status", direction: "asc" });
  });

  it("rejects a defaultSort naming a non-existent field", async () => {
    writeSkill("test-sort-missing", {
      title: "Missing Sort Field",
      icon: "sort",
      dataPath: "data/sortmissing/items",
      primaryKey: "id",
      fields: baseFields,
      defaultSort: { field: "nope", direction: "asc" },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "defaultSort pointing at a missing field must be skipped");
  });

  it("rejects a defaultSort naming a non-sortable field", async () => {
    writeSkill("test-sort-nonsortable", {
      title: "Non-sortable Sort Field",
      icon: "sort",
      dataPath: "data/sortnonsortable/items",
      primaryKey: "id",
      fields: baseFields,
      defaultSort: { field: "notes", direction: "asc" }, // markdown → no sort button
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "defaultSort on a markdown field must be skipped");
  });
});
