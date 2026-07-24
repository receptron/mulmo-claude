// Pure neighbor derivation for the collection view's related-collections
// pulldown (plans/done/feat-collection-related-dropdown.md). Given the raw
// workspace-ontology entries (the same list the /collections Map tab builds
// its graph from) and the active collection's slug, list the collections it
// links to or that link back to it — one entry per neighbor, with the
// navigation direction. Kept pure + exported so it stays unit-testable and
// the component's own functions honour the 20-line rule.

import { buildOntologyGraph, type CollectionOntologyEntry, type OntologyGraph } from "@mulmoclaude/core/collection";

/** A collection reachable from the active one via a schema relation. */
export interface RelatedCollection {
  slug: string;
  title: string;
  icon: string;
  /** `out` — the active collection refs/embeds this one; `in` — this one
   *  refs/embeds the active collection; `both` — mutual (a ref plus its
   *  collapsed backlinks/rollup reverse, or two opposing refs). */
  direction: "out" | "in" | "both";
}

type Direction = RelatedCollection["direction"];

/** Fold a new direction observation into the one already recorded for a
 *  neighbor: same direction is idempotent, opposing directions become `both`. */
const mergeDirection = (prev: Direction | undefined, next: Direction): Direction => (prev === undefined || prev === next ? next : "both");

/** Walk the graph edges touching `slug` and record each neighbor's direction.
 *  Skips self-edges (a collection ref-ing itself) and ghost nodes (a relation
 *  target no discovered collection backs — nothing to navigate to). An edge
 *  carrying `reverseFields` is a bidirectional pair collapsed to one edge, so
 *  it contributes BOTH directions to its neighbor. */
function collectDirections(graph: OntologyGraph, slug: string): Map<string, Direction> {
  const nodeBySlug = new Map(graph.nodes.map((node) => [node.slug, node]));
  const directions = new Map<string, Direction>();
  const add = (neighbor: string, direction: Direction): void => {
    if (neighbor === slug) return;
    const node = nodeBySlug.get(neighbor);
    if (!node || node.missing) return;
    directions.set(neighbor, mergeDirection(directions.get(neighbor), direction));
  };
  for (const edge of graph.edges) {
    const bidirectional = (edge.reverseFields?.length ?? 0) > 0;
    if (edge.from === slug) {
      add(edge.to, "out");
      if (bidirectional) add(edge.to, "in");
    }
    if (edge.to === slug) {
      add(edge.from, "in");
      if (bidirectional) add(edge.from, "out");
    }
  }
  return directions;
}

/** Collections related to `slug`, in graph node order (title/icon from the
 *  node), empty when it has no navigable relations. */
export function relatedCollections(entries: CollectionOntologyEntry[], slug: string): RelatedCollection[] {
  const graph = buildOntologyGraph(entries);
  const directions = collectDirections(graph, slug);
  const related: RelatedCollection[] = [];
  for (const node of graph.nodes) {
    const direction = directions.get(node.slug);
    if (direction !== undefined) related.push({ slug: node.slug, title: node.title, icon: node.icon, direction });
  }
  return related;
}
