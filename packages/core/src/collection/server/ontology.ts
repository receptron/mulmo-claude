// The machine-readable workspace ontology (plan step ① of
// plans/done/collection-ontology.md): one entry per discovered collection with
// the identity + relationship facts an agent needs to reason ACROSS
// collections — which slugs exist, how they point at each other, how big
// they are — without re-reading every schema.json. Derived on demand from
// the schemas (no authoring, no storage), so it can never go stale.
// Deliberately NOT a unified schema: collections stay bounded contexts;
// semantic joining happens at read time in the caller.

import { readdir } from "node:fs/promises";
import path from "node:path";
import { discoverCollections, type DiscoveryOptions } from "./discovery";
import { storeFor } from "./store";
import { isBackendUnavailable } from "./backendAvailability";
import { storageKindFor } from "../core/schema";
import { isRegularFile } from "./io";
import { isContainedInRoot } from "./paths";
import { getWorkspaceRoot } from "./host";
import type { LoadedCollection } from "./discoveredCollection";
import type { CollectionSchema } from "../core/schema";
import type { CollectionOntologyEntry, OntologyRelation } from "../core/ontologyGraph";

// The entry/relation types live browser-safe in core/ontologyGraph.ts
// (the Map panel builds the graph client-side from the raw entries);
// re-exported here so the server subpath's surface is unchanged.
export type { CollectionOntologyEntry, OntologyRelation } from "../core/ontologyGraph";

/** Extract the relations a schema declares, in field declaration order:
 *  top-level `ref` / `embed` / `backlinks` fields plus `ref` sub-fields
 *  inside `table` columns. Pure — exported so the phase-2 graph panel
 *  can reuse it on already-loaded schemas. */
export function schemaRelations(schema: CollectionSchema): OntologyRelation[] {
  const relations: OntologyRelation[] = [];
  for (const [key, spec] of Object.entries(schema.fields)) {
    if (spec.type === "ref" || spec.type === "embed") relations.push({ field: key, kind: spec.type, to: spec.to });
    if (spec.type === "backlinks" || spec.type === "rollup") relations.push({ field: key, kind: spec.type, to: spec.from, via: spec.via });
    if (spec.type !== "table") continue;
    for (const [subKey, subSpec] of Object.entries(spec.of)) {
      if (subSpec.type === "ref") relations.push({ field: `${key}.${subKey}`, kind: "ref", to: subSpec.to });
    }
  }
  return relations;
}

/** Count the record files in a collection's data dir — the same
 *  `<id>.json` entries `listItems` considers, WITHOUT parsing them (the
 *  ontology is a summary; a malformed record is still a record). Each
 *  candidate is classified by the SHARED `isRegularFile` lstat helper —
 *  the exact file-disclosure defense `listItems` applies — so a
 *  symlinked record never counts and the count can't diverge from the
 *  readable set on any filesystem (Codex review on PR #2099, twice).
 *  Fail-soft: a missing dir or a dataDir escaping the workspace via
 *  symlink counts 0. */
async function countRecordFiles(dataDir: string, workspaceRoot: string): Promise<number> {
  if (!isContainedInRoot(dataDir, workspaceRoot)) return 0;
  try {
    const names = (await readdir(dataDir)).filter((name) => name.endsWith(".json") && !name.startsWith("."));
    const checks = await Promise.all(names.map((name) => isRegularFile(path.join(dataDir, name))));
    return checks.filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** A collection's record count for the ontology. File-backed: the cheap
 *  readdir count. Every other backend (`dataSource` CSV, `storage`
 *  sqlite): the store's page total — the dataDir is a phantom there, so
 *  the readdir count would always misreport 0. Fail-soft to 0 like
 *  `countRecordFiles` (an unreadable file / missing engine must not
 *  break the whole ontology). */
async function countRecords(collection: LoadedCollection, workspaceRoot: string): Promise<number | null> {
  if (storageKindFor(collection.schema) !== "file") {
    try {
      return (await storeFor(collection, { workspaceRoot }).page({ limit: 0 })).total;
    } catch (err) {
      // `null` = "couldn't count", which is NOT zero. Reporting an
      // unreachable backend as 0 reads as "this collection is empty" and
      // invites the agent to repopulate records that are perfectly intact.
      if (isBackendUnavailable(err)) return null;
      return 0;
    }
  }
  return countRecordFiles(collection.dataDir, workspaceRoot);
}

async function toOntologyEntry(collection: LoadedCollection, workspaceRoot: string): Promise<CollectionOntologyEntry> {
  const { schema } = collection;
  return {
    slug: collection.slug,
    title: schema.title,
    icon: schema.icon,
    primaryKey: schema.primaryKey,
    displayField: schema.displayField ?? schema.primaryKey,
    recordCount: await countRecords(collection, workspaceRoot),
    relations: schemaRelations(schema),
  };
}

/** Build the workspace ontology: every discovered collection (slug-sorted,
 *  discovery's order), each with its outbound relations and a
 *  readdir-cheap record count — fine to call on demand. */
export async function buildWorkspaceOntology(opts: DiscoveryOptions = {}): Promise<CollectionOntologyEntry[]> {
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  const collections = await discoverCollections(opts);
  return Promise.all(collections.map((collection) => toOntologyEntry(collection, workspaceRoot)));
}
