// Unit tests for the pure related-collections helper
// (packages/plugins/collection-plugin/src/vue/relatedCollections.ts) — the
// neighbor derivation backing the collection view's related-collections
// pulldown (plans/done/feat-collection-related-dropdown.md). Its
// direction/collapse/ghost/self-edge semantics are pinned here so the
// component can stay a thin renderer.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { CollectionOntologyEntry, OntologyRelation } from "@mulmoclaude/core/collection";
import { relatedCollections } from "../../../packages/plugins/collection-plugin/src/vue/relatedCollections";

const entry = (slug: string, relations: OntologyRelation[] = []): CollectionOntologyEntry => ({
  slug,
  title: slug.toUpperCase(),
  icon: `icon-${slug}`,
  primaryKey: "id",
  displayField: "id",
  recordCount: 0,
  relations,
});

describe("relatedCollections", () => {
  it("lists a plain forward ref as an `out` neighbor", () => {
    const entries = [entry("invoices", [{ field: "clientId", kind: "ref", to: "clients" }]), entry("clients")];
    assert.deepEqual(relatedCollections(entries, "invoices"), [{ slug: "clients", title: "CLIENTS", icon: "icon-clients", direction: "out" }]);
  });

  it("lists the reverse side of the same ref as an `in` neighbor", () => {
    const entries = [entry("invoices", [{ field: "clientId", kind: "ref", to: "clients" }]), entry("clients")];
    assert.deepEqual(relatedCollections(entries, "clients"), [{ slug: "invoices", title: "INVOICES", icon: "icon-invoices", direction: "in" }]);
  });

  it("collapses a ref + its backlinks reverse into a single `both` neighbor", () => {
    // clients declares backlinks over invoices.clientId; the graph collapses
    // that onto the forward ref edge (reverseFields), so each side sees ONE
    // bidirectional neighbor rather than a duplicate.
    const entries = [
      entry("invoices", [{ field: "clientId", kind: "ref", to: "clients" }]),
      entry("clients", [{ field: "invoiceLinks", kind: "backlinks", to: "invoices", via: "clientId" }]),
    ];
    assert.deepEqual(relatedCollections(entries, "invoices"), [{ slug: "clients", title: "CLIENTS", icon: "icon-clients", direction: "both" }]);
    assert.deepEqual(relatedCollections(entries, "clients"), [{ slug: "invoices", title: "INVOICES", icon: "icon-invoices", direction: "both" }]);
  });

  it("marks two opposing plain refs as `both`", () => {
    const entries = [entry("a", [{ field: "bId", kind: "ref", to: "b" }]), entry("b", [{ field: "aId", kind: "ref", to: "a" }])];
    assert.deepEqual(relatedCollections(entries, "a"), [{ slug: "b", title: "B", icon: "icon-b", direction: "both" }]);
  });

  it("skips ghost targets (a ref pointing at no discovered collection)", () => {
    const entries = [entry("invoices", [{ field: "clientId", kind: "ref", to: "missing" }])];
    assert.deepEqual(relatedCollections(entries, "invoices"), []);
  });

  it("skips a self-edge (a collection ref-ing itself)", () => {
    const entries = [entry("tasks", [{ field: "parentId", kind: "ref", to: "tasks" }])];
    assert.deepEqual(relatedCollections(entries, "tasks"), []);
  });

  it("returns an empty list for a collection with no relations", () => {
    const entries = [entry("standalone"), entry("other")];
    assert.deepEqual(relatedCollections(entries, "standalone"), []);
  });

  it("lists multiple neighbors in graph node order", () => {
    const entries = [
      entry("orders", [
        { field: "clientId", kind: "ref", to: "clients" },
        { field: "productId", kind: "ref", to: "products" },
      ]),
      entry("clients"),
      entry("products"),
    ];
    assert.deepEqual(
      relatedCollections(entries, "orders").map((related) => related.slug),
      ["clients", "products"],
    );
  });
});
