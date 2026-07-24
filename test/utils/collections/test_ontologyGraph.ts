// Unit tests for the pure ontology graph builder
// (packages/core/src/collection/core/ontologyGraph.ts) — the one
// implementation the /collections Map panel builds its graph with from
// the raw buildWorkspaceOntology entries, so its collapse/ghost/order
// semantics are pinned here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildOntologyGraph, type CollectionOntologyEntry, type OntologyRelation } from "@mulmoclaude/core/collection";

const entry = (slug: string, relations: OntologyRelation[] = [], recordCount: number | null = 0): CollectionOntologyEntry => ({
  slug,
  title: slug.toUpperCase(),
  icon: "📦",
  primaryKey: "id",
  displayField: "id",
  recordCount,
  relations,
});

describe("buildOntologyGraph — nodes", () => {
  it("emits one node per entry, preserving entry order and metadata", () => {
    const graph = buildOntologyGraph([entry("clients", [], 3), entry("invoices", [], 7)]);
    assert.deepEqual(
      graph.nodes.map((node) => [node.slug, node.title, node.recordCount, node.missing]),
      [
        ["clients", "CLIENTS", 3, undefined],
        ["invoices", "INVOICES", 7, undefined],
      ],
    );
  });

  it("appends slug-sorted ghost nodes for relation targets no entry backs", () => {
    const graph = buildOntologyGraph([
      entry("invoices", [
        { field: "clientId", kind: "ref", to: "zeta" },
        { field: "projectId", kind: "ref", to: "alpha" },
      ]),
    ]);
    assert.deepEqual(
      graph.nodes.map((node) => [node.slug, node.missing]),
      [
        ["invoices", undefined],
        ["alpha", true],
        ["zeta", true],
      ],
    );
    const ghost = graph.nodes.find((node) => node.slug === "alpha");
    assert.equal(ghost?.title, "alpha");
    assert.equal(ghost?.recordCount, 0);
  });
});

describe("buildOntologyGraph — edges", () => {
  it("emits forward edges for ref and embed, including dotted table sub-refs", () => {
    const graph = buildOntologyGraph([
      entry("invoices", [
        { field: "clientId", kind: "ref", to: "clients" },
        { field: "lines.itemId", kind: "ref", to: "items" },
        { field: "clientCard", kind: "embed", to: "clients" },
      ]),
      entry("clients"),
      entry("items"),
    ]);
    assert.deepEqual(graph.edges, [
      { from: "invoices", to: "clients", field: "clientId", kind: "ref" },
      { from: "invoices", to: "items", field: "lines.itemId", kind: "ref" },
      { from: "invoices", to: "clients", field: "clientCard", kind: "embed" },
    ]);
  });

  it("collapses backlinks/rollup onto the ref edge their via names", () => {
    const graph = buildOntologyGraph([
      entry("clients", [
        { field: "invoiceLinks", kind: "backlinks", to: "invoices", via: "clientId" },
        { field: "totalBilled", kind: "rollup", to: "invoices", via: "clientId" },
      ]),
      entry("invoices", [{ field: "clientId", kind: "ref", to: "clients" }]),
    ]);
    assert.deepEqual(graph.edges, [{ from: "invoices", to: "clients", field: "clientId", kind: "ref", reverseFields: ["invoiceLinks", "totalBilled"] }]);
  });

  it("collapses independently of entry order (reverse declared before the ref owner)", () => {
    const forwardFirst = buildOntologyGraph([
      entry("invoices", [{ field: "clientId", kind: "ref", to: "clients" }]),
      entry("clients", [{ field: "invoiceLinks", kind: "backlinks", to: "invoices", via: "clientId" }]),
    ]);
    assert.equal(forwardFirst.edges.length, 1);
    assert.deepEqual(forwardFirst.edges[0].reverseFields, ["invoiceLinks"]);
  });

  it("collapses each rollup onto ITS via edge when several refs link the same pair (matches.homeTeam vs awayTeam)", () => {
    // The W杯2026 standings shape from plans/done/collection-ontology.md:
    // a match points at a team via homeTeam OR awayTeam, and the team
    // rolls up each side separately. Pair-only matching would pile both
    // rollups onto whichever ref edge comes first (Codex review on
    // #2218) — via keeps them apart.
    const graph = buildOntologyGraph([
      entry("matches", [
        { field: "homeTeam", kind: "ref", to: "teams" },
        { field: "awayTeam", kind: "ref", to: "teams" },
      ]),
      entry("teams", [
        { field: "homePlayed", kind: "rollup", to: "matches", via: "homeTeam" },
        { field: "awayPlayed", kind: "rollup", to: "matches", via: "awayTeam" },
      ]),
    ]);
    assert.deepEqual(graph.edges, [
      { from: "matches", to: "teams", field: "homeTeam", kind: "ref", reverseFields: ["homePlayed"] },
      { from: "matches", to: "teams", field: "awayTeam", kind: "ref", reverseFields: ["awayPlayed"] },
    ]);
  });

  it("keeps an uncollapsed backlinks as its own edge in true data direction", () => {
    const graph = buildOntologyGraph([entry("clients", [{ field: "mentions", kind: "backlinks", to: "notes", via: "clientId" }])]);
    assert.deepEqual(graph.edges, [{ from: "notes", to: "clients", field: "mentions", kind: "backlinks" }]);
    assert.equal(graph.nodes.find((node) => node.slug === "notes")?.missing, true);
  });

  it("keeps a reverse relation uncollapsed when its via names no forward ref field", () => {
    // A backlinks whose via points at a nonexistent / renamed ref must
    // not silently attach to some other ref between the same pair —
    // fail-soft as its own edge, like every dangling reference.
    const graph = buildOntologyGraph([
      entry("invoices", [{ field: "clientId", kind: "ref", to: "clients" }]),
      entry("clients", [{ field: "invoiceLinks", kind: "backlinks", to: "invoices", via: "renamedField" }]),
    ]);
    assert.deepEqual(graph.edges, [
      { from: "invoices", to: "clients", field: "clientId", kind: "ref" },
      { from: "invoices", to: "clients", field: "invoiceLinks", kind: "backlinks" },
    ]);
  });

  it("does not collapse a reverse relation onto an embed edge, even when via matches its field", () => {
    const graph = buildOntologyGraph([
      entry("clients", [{ field: "invoiceLinks", kind: "backlinks", to: "invoices", via: "clientCard" }]),
      entry("invoices", [{ field: "clientCard", kind: "embed", to: "clients" }]),
    ]);
    assert.deepEqual(graph.edges.map((edge) => edge.kind).sort(), ["backlinks", "embed"]);
  });
});

describe("recordCount — unreachable is not empty", () => {
  // A backend that couldn't be counted (engine failed to load, session
  // closed) reports `null`, never 0. Zero says "this collection is empty",
  // which invites restoring records that are intact but out of reach.
  it("carries a null count through to the graph node", () => {
    const graph = buildOntologyGraph([entry("cloud", [], null)]);
    const node = graph.nodes.find((candidate) => candidate.slug === "cloud");
    assert.ok(node);
    assert.equal(node.recordCount, null, "an uncounted collection must stay null, not collapse to 0");
  });

  it("still uses 0 for a ghost node, which genuinely holds nothing", () => {
    // A relation pointing at a slug no collection provides: the node exists
    // only as a broken-ref marker, so 0 is the honest count.
    const graph = buildOntologyGraph([entry("orders", [{ kind: "ref", field: "customer", to: "customers" }])]);
    const ghost = graph.nodes.find((candidate) => candidate.slug === "customers");
    assert.ok(ghost);
    assert.equal(ghost.missing, true);
    assert.equal(ghost.recordCount, 0);
  });
});
