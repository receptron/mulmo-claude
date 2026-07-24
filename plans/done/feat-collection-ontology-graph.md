# feat(collections): ontology graph panel — the workspace map

Date: 2026-07-19
Origin: survey of [microsoft/Ontology-Playground](https://github.com/microsoft/Ontology-Playground) (ER-style ontology model rendered as an interactive graph) → realization that MulmoClaude already shipped the data layer for this as step ① of [plans/done/collection-ontology.md](done/collection-ontology.md), which closed with *"Still open if demand appears: the `/collections` ontology graph panel (①'s phase 2)."* This plan finishes that pending phase.

## Why

- Every ingredient already exists but is never rendered: schemas carry `icon`, `ref`/`embed` fields carry `to`, `backlinks`/`rollup` carry `from`, and `buildWorkspaceOntology` (`packages/core/src/collection/server/ontology.ts`) already derives slug/title/icon/recordCount/relations per collection. `schemaRelations` is exported *specifically* for this panel (see its doc comment).
- Strategy fit: the wiki bet is "favor features that **surface** the links Claude maintains" — this surfaces them one level up, at the schema layer. It also gives the "assistant you nurture" framing a visible artifact: the map gains nodes and edges as Claude grows the workspace.
- Precedent: the wiki page→page graph (`packages/core/src/wiki/graph.ts` + `src/plugins/wiki/components/WikiGraphView.vue`, ECharts force layout).

## Design

Schema-level only. **No per-record instance graph** — that drifts toward the "unified workspace schema" the ontology plan explicitly rejected. No layout persistence, no editing from the graph; it is a read surface.

### 1. Core — pure graph builder

`packages/core/src/collection/core/ontologyGraph.ts` (browser-safe `core/`, no `node:*` imports, same discipline as `wiki/graph.ts`):

- `buildOntologyGraph(entries: CollectionOntologyEntry[]): OntologyGraph` — nodes `{slug, title, icon, recordCount, missing?}`, edges `{from, to, field, kind, reverseField?}`.
- **Edge collapsing**: a `backlinks`/`rollup` relation is the declared reverse of a `ref` — when the forward edge already exists, merge into one edge (record the reverse field name) instead of drawing two arrows.
- **Fail-soft ghosts**: a relation targeting a non-discovered collection produces a `missing: true` ghost node rather than being dropped — the graph doubles as a broken-ref lint surface ("lint, not lock").
- `CollectionOntologyEntry` / `OntologyRelation` move here (server `ontology.ts` re-imports downhill) so the Vue plugin can import the types without touching the server subpath.
- Unit tests: edge collapsing, ghost nodes, dotted `table.subRef` fields (`lines.clientId`), embed styling kind.
- 1-line entry in `docs/shared-utils.md`, same PR.

### 2. Server — one thin route

- `GET /api/collections/ontology` in `server/api/routes/collections.ts` → `buildWorkspaceOntology()` entries, raw. The client builds the graph with the shared pure helper (server/client parity discipline, same as `deriveAll`).
- Constant in `src/config/apiRoutes.ts` under `collections`.

### 3. UI — "Map" tab in `/collections`

- Third tab in `CollectionsIndexView.vue` (Installed | Discover | **Map**), `data-testid="collections-tab-map"`.
- New `CollectionOntologyGraphView.vue` in collection-plugin, modeled on `WikiGraphView.vue`: ECharts force graph, imperative instance (no Vue reactivity wrapping), node label = icon + title, `symbolSize` log-scaled by `recordCount`, ghost nodes greyed, arrow in `ref` direction with field name as edge label, dashed lines for display-only kinds (`embed`, uncollapsed `backlinks`/`rollup`), node click → open that collection.
- `echarts` as **peerDependency** of collection-plugin (chart-plugin precedent; host ships `echarts@^6.1.0`).
- i18n: tab label + empty state in all 8 locales.
- E2E (mock, Playwright): Map tab renders the graph canvas testid for a workspace with two ref-linked collections.

### 4. Release chores

- Same-PR bumps: `@mulmoclaude/core` (new export) and `@mulmoclaude/collection-plugin` (new view; real ratchet of its core range — it consumes the new core API), plus launcher dep-range lockstep. NOT the launcher's own `version`.
- **MulmoTerminal follow-up**: its `server/backends` needs the matching `/api/collections/ontology` route port before bumping to the new plugin version, or the Map tab breaks there.
- Update the closing line of `plans/done/collection-ontology.md` when phase 2 ships.

## Rejected

- Per-record instance graph (see Design).
- RDF/OWL import-export, catalogue compile step, NL-query simulation — Ontology-Playground features that solve problems MulmoClaude doesn't have (interop credibility, no backend, no real LLM).
