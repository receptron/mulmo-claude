// Pure builder for the workspace ontology graph — the `/collections` Map
// panel (phase 2 of plans/done/collection-ontology.md step ①; plan:
// plans/done/feat-collection-ontology-graph.md). Consumes the per-collection
// ontology entries `buildWorkspaceOntology` derives server-side and turns
// them into a node/edge structure a graph view can render directly.
// Browser-safe (no `node:*` imports) so the Vue plugin builds the same
// graph from the raw entries — same parity discipline as `deriveAll` and
// the sibling `wiki/graph.ts`.

/** One relationship a schema declares: a `ref` (the record stores the
 *  target's primaryKey slug) or `embed` (display-only pull) pointing at
 *  collection `to`, or `backlinks` / `rollup` (display-only REVERSE
 *  refs — `to` is the relation's source collection, i.e. its `from`,
 *  and `via` names the exact ref field there being reversed).
 *  A `ref` column inside a `table` field is reported with a dotted path
 *  (`lines.clientId`). Whether `to` exists is NOT checked — resolution
 *  is fail-soft at render. */
export interface OntologyRelation {
  field: string;
  kind: "ref" | "embed" | "backlinks" | "rollup";
  to: string;
  via?: string;
}

export interface CollectionOntologyEntry {
  slug: string;
  title: string;
  icon: string;
  primaryKey: string;
  /** The effective display field: the schema's `displayField`, falling
   *  back to the primaryKey exactly as render-time labelling does. */
  displayField: string;
  /** Records in the collection, or `null` when the backend couldn't be
   *  reached to count them (an engine that failed to load, a closed
   *  session). Deliberately not 0: an unreachable collection reported as
   *  empty invites "restoring" data that is intact but out of reach. */
  recordCount: number | null;
  relations: OntologyRelation[];
}

export interface OntologyGraphNode {
  slug: string;
  title: string;
  icon: string;
  recordCount: number | null;
  /** No discovered collection has this slug — the node exists only
   *  because a relation points at it. Rendered as a ghost so the graph
   *  doubles as a broken-ref lint surface (lint, not lock). */
  missing?: boolean;
}

export interface OntologyGraphEdge {
  /** Tail: the collection whose records store (`ref`) or pull (`embed`)
   *  the link — or, for an uncollapsed reverse relation, the collection
   *  whose refs the `backlinks`/`rollup` field aggregates. */
  from: string;
  /** Head: the collection the link points at. */
  to: string;
  /** Field declaring the relation — on `from` for `ref`/`embed`, on
   *  `to` for an uncollapsed `backlinks`/`rollup`. */
  field: string;
  kind: OntologyRelation["kind"];
  /** `backlinks`/`rollup` field names on `to` that declare the reverse
   *  of this `ref` edge, collapsed here so one link never draws twice. */
  reverseFields?: string[];
}

export interface OntologyGraph {
  nodes: OntologyGraphNode[];
  edges: OntologyGraphEdge[];
}

const isForwardKind = (kind: OntologyRelation["kind"]): boolean => kind === "ref" || kind === "embed";

/** Fold a reverse relation (`backlinks`/`rollup` declared on `owner`)
 *  into the edge list: collapse onto the forward `ref` edge whose field
 *  is the relation's declared `via` (several refs can link the same
 *  pair — matches.homeTeam vs matches.awayTeam — so the pair alone is
 *  ambiguous), else emit its own edge oriented in true data direction
 *  (refs' source → owner). A `via` naming no forward edge stays
 *  uncollapsed — fail-soft, like every other dangling reference. */
const addReverseRelation = (edges: OntologyGraphEdge[], owner: string, rel: OntologyRelation): void => {
  const forward = edges.find((edge) => edge.kind === "ref" && edge.from === rel.to && edge.to === owner && (rel.via === undefined || edge.field === rel.via));
  if (forward) {
    forward.reverseFields = [...(forward.reverseFields ?? []), rel.field];
    return;
  }
  edges.push({ from: rel.to, to: owner, field: rel.field, kind: rel.kind });
};

/** Two passes so every forward `ref` edge exists before any reverse
 *  relation tries to collapse onto one — entry order must not matter. */
const collectEdges = (entries: CollectionOntologyEntry[]): OntologyGraphEdge[] => {
  const edges: OntologyGraphEdge[] = [];
  for (const entry of entries) {
    for (const rel of entry.relations) {
      if (isForwardKind(rel.kind)) edges.push({ from: entry.slug, to: rel.to, field: rel.field, kind: rel.kind });
    }
  }
  for (const entry of entries) {
    for (const rel of entry.relations) {
      if (!isForwardKind(rel.kind)) addReverseRelation(edges, entry.slug, rel);
    }
  }
  return edges;
};

/** Slugs referenced by an edge endpoint but backed by no discovered
 *  collection, slug-sorted for deterministic node order. */
const ghostSlugs = (edges: OntologyGraphEdge[], known: ReadonlySet<string>): string[] => {
  const ghosts = new Set<string>();
  for (const edge of edges) {
    if (!known.has(edge.from)) ghosts.add(edge.from);
    if (!known.has(edge.to)) ghosts.add(edge.to);
  }
  return [...ghosts].sort();
};

/** Build the renderable graph: one node per discovered collection (in
 *  the entries' slug-sorted order) plus ghost nodes for dangling
 *  targets, one edge per underlying link. */
export const buildOntologyGraph = (entries: CollectionOntologyEntry[]): OntologyGraph => {
  const edges = collectEdges(entries);
  const known = new Set(entries.map((entry) => entry.slug));
  const nodes: OntologyGraphNode[] = entries.map(({ slug, title, icon, recordCount }) => ({ slug, title, icon, recordCount }));
  for (const slug of ghostSlugs(edges, known)) {
    // A ghost node has no collection behind it at all, so it genuinely holds
    // no records — 0, not the "couldn't count" null.
    nodes.push({ slug, title: slug, icon: "", recordCount: 0, missing: true });
  }
  return { nodes, edges };
};
