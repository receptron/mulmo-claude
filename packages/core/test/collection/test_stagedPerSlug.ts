// Staging is decided per SLUG, not per root.
//
// `stagingSkillDir(root, slug)` only knows whether the ROOT has a staging tree;
// it then joins the slug, so on its own it claims every collection in a staged
// workspace is staged. A staged workspace holds other layouts too — a
// collection imported through the discover panel, or one committed directly
// under `.claude/skills/` — and a leftover `data/skills/<slug>/views/*.html`
// beside one of those used to win on every read (#3031). Silently, and against
// the copy the repository actually commits.
//
// `test_nullStaging.ts` pins the root-level answer (a root with NO staging tree
// at all). This file pins the slug-level one, in a root that HAS one — and
// pins that reads and deletes reach the same conclusion, which is what
// `views.ts` has claimed in its comments since #1836 and now shares one
// predicate to guarantee.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { configureCollectionHost, loadCollection, readCustomViewHtml, deleteCustomView } from "../../src/collection/server/index.ts";
import { makeTempDir } from "../helpers/tempDir.js";

const noopLog = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

configureCollectionHost({
  workspaceRoot: null,
  log: noopLog,
  paths: {
    userSkillsDir: () => null,
    projectSkillsDir: (root) => path.join(root, ".claude", "skills"),
    feedsRoot: (root) => path.join(root, "data", "feeds"),
    // The difference from test_nullStaging.ts: this root DOES stage.
    skillsStagingDir: (root) => path.join(root, "data", "skills"),
    archiveDir: "data/archive",
    collectionsRegistriesConfig: (root) => path.join(root, "config", "collections-registries.json"),
  },
  isPresetSlug: () => false,
});

const schemaFor = (slug: string) => ({
  title: slug,
  icon: "list",
  primaryKey: "id",
  dataPath: `data/${slug}`,
  fields: { id: { type: "string", label: "Id", primary: true } },
  views: [{ id: "board", label: "Board", file: "views/board.html", capabilities: ["read"] }],
});

/** The discovery anchor every project collection has, whichever layout it uses. */
function writeSkillDir(root: string, slug: string, viewBody: string | null): void {
  const skillDir = path.join(root, ".claude", "skills", slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "schema.json"), JSON.stringify(schemaFor(slug)));
  if (viewBody !== null) {
    mkdirSync(path.join(skillDir, "views"), { recursive: true });
    writeFileSync(path.join(skillDir, "views", "board.html"), viewBody);
  }
}

/** The staging tree the authoring layout produces. `schema.json` is what makes
 *  it one — `putSchema` writes it, and it is the evidence both the read and the
 *  delete key on. Omit it (`staged: false`) and the tree is the stale residue
 *  an agent leaves behind after following the staged instructions elsewhere. */
function writeStagingDir(root: string, slug: string, viewBody: string, staged: boolean): void {
  const stagingDir = path.join(root, "data", "skills", slug);
  mkdirSync(path.join(stagingDir, "views"), { recursive: true });
  if (staged) writeFileSync(path.join(stagingDir, "schema.json"), JSON.stringify(schemaFor(slug)));
  writeFileSync(path.join(stagingDir, "views", "board.html"), viewBody);
}

/** One workspace, both layouts — which is the shape the bug needed. `authored`
 *  is properly staged; `committed` is not, and carries a stale staging view. */
function makeMixedRoot(prefix: string): string {
  const root = makeTempDir(prefix);
  writeSkillDir(root, "authored", null);
  writeStagingDir(root, "authored", "<p>staged</p>", true);
  writeSkillDir(root, "committed", "<p>committed</p>");
  writeStagingDir(root, "committed", "<p>stale staged</p>", false);
  return root;
}

test("a staged slug still reads its staging copy", async () => {
  const root = makeMixedRoot("sps-read-staged-");
  const collection = await loadCollection("authored", { workspaceRoot: root });
  assert.ok(collection);
  assert.equal(await readCustomViewHtml(collection, "views/board.html", { workspaceRoot: root }), "<p>staged</p>");
});

// The regression. Before #3031 this returned `<p>stale staged</p>` — the root
// had a staging tree, so every slug in it was treated as staged.
test("a slug with no staged schema reads its committed view, not the leftover staging one", async () => {
  const root = makeMixedRoot("sps-read-committed-");
  const collection = await loadCollection("committed", { workspaceRoot: root });
  assert.ok(collection);
  assert.equal(await readCustomViewHtml(collection, "views/board.html", { workspaceRoot: root }), "<p>committed</p>");
});

// Reads and deletes have to agree about which copy is the real one, or a delete
// reports success while the view it removed was not the one being rendered.
test("delete removes the copy the read serves — staged slug", async () => {
  const root = makeMixedRoot("sps-del-staged-");
  const collection = await loadCollection("authored", { workspaceRoot: root });
  assert.ok(collection);

  assert.deepEqual(await deleteCustomView(collection, "board", { workspaceRoot: root }), { kind: "ok", viewId: "board" });
  assert.equal(existsSync(path.join(root, "data", "skills", "authored", "views", "board.html")), false);
  // Both schema copies drop the entry: the staged one is canonical, the active
  // one is the discovery anchor.
  for (const base of [path.join(root, "data", "skills", "authored"), path.join(root, ".claude", "skills", "authored")]) {
    const parsed: unknown = JSON.parse(readFileSync(path.join(base, "schema.json"), "utf-8"));
    assert.deepEqual((parsed as { views: unknown[] }).views, [], `views[] must be empty in ${base}`);
  }
});

test("delete removes the copy the read serves — unstaged slug leaves the stale tree alone", async () => {
  const root = makeMixedRoot("sps-del-committed-");
  const collection = await loadCollection("committed", { workspaceRoot: root });
  assert.ok(collection);

  assert.deepEqual(await deleteCustomView(collection, "board", { workspaceRoot: root }), { kind: "ok", viewId: "board" });
  assert.equal(
    existsSync(path.join(root, ".claude", "skills", "committed", "views", "board.html")),
    false,
    "the committed view is the one that was rendered, so it is the one removed",
  );
  // The stale tree is not this collection's staging dir, so the delete does not
  // reach into it — same reasoning as the null-staging root's delete.
  assert.equal(existsSync(path.join(root, "data", "skills", "committed", "views", "board.html")), true);
});
