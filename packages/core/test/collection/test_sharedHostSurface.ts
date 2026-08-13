// The surface a SHARED-COLLECTION HOST needs from this package.
//
// Shared collections are hosted by MulmoTerminal, which owns the operations
// (deploy / publish / unpublish), their write ORDER, and the tool the agent
// calls. This package owns the pure parts: what is valid, what the documents
// look like, where they live.
//
// This test exists because that split only pays off if the host never has to
// come back here. Every symbol below is one MulmoTerminal imports; a refactor
// that drops or renames one is a cross-repository release, not a local edit,
// so it should fail HERE first — while the person doing it is still looking at
// this package.
//
// Adding to this list is fine. Removing from it means a host is about to break.
import { test } from "node:test";
import assert from "node:assert/strict";

import * as server from "../../src/collection/server/index.ts";

const HOST_SURFACE = [
  // the host seam: who serves shared collections, and with whose session
  "configureCollectionHost",
  "setSharedCollectionsSupport",
  "hostSupportsSharedCollections",
  "setFirestoreAccessor",
  "firestoreHandle",
  // reading the repository's declaration
  "parseAuthoredApp",
  "AuthoredAppZ",
  "loadAppManifest",
  "APP_MANIFEST_FILE",
  // the gates — what publish refuses, and which live records a schema breaks
  "publishProblems",
  // The pair publish actually writes: the staged configuration beside the
  // manifest's roster. Separate from `publishProblems` because it needs what
  // deploy staged, which is a read the host makes.
  "promotedRoleProblems",
  "bindsSubmitterIdentity",
  "validateCollectionRecords",
  "MAX_RECORD_ISSUES",
  "STORE_UNREADABLE",
  // finding the collections to deploy
  "discoverCollections",
  "loadCollection",
  // authored -> written: the deploy half, the publish half, and promotion
  "projectApp",
  "projectDeploy",
  "projectPublish",
  "promoteSchema",
  // the declaration the host projects itself: normalization (so "which
  // spelling was used" is decided once, here, where the publish gate also
  // decides it), the participant's read scope (the rules' own answer), and the
  // one submit conversion both projections must agree on
  "normalizeViews",
  "participantScope",
  "projectSubmit",
  "viewDocId",
  "viewConfigDocId",
  "VIEW_TIER",
  // where each document lives, and the shapes the rules read
  "APPS_COLLECTION",
  "PUBLIC_CONFIG_DOC",
  "appConfigPath",
  "appSchemasPath",
  "appStagingPath",
  "APP_SLUGS_COLLECTION",
  "appSlugDoc",
  "sharedItemsPath",
];

test("every symbol a shared-collection host imports is exported", () => {
  const missing = HOST_SURFACE.filter((name) => !(name in server));
  assert.deepEqual(missing, [], `not exported from @mulmoclaude/core/collection/server: ${missing.join(", ")}`);
});

test("the per-tier projection belongs to the host, not here", () => {
  // `projectAppViews` and `writeFor` used to live here, and every field added
  // to `{tier}/config` was therefore a release of this package followed by a
  // wait — for a document with exactly one writer (MulmoTerminal) and one
  // reader (mulmoserver), neither of which is this package. They moved to
  // mulmoterminal `server/backends/sharedApp/appViewProjection.ts`.
  //
  // They must not come back. Two projections of one document is the divergence
  // nothing here would notice: this package's tests would pass on its copy
  // while the host wrote the other one. See mulmoterminal
  // `plans/refactor-shared-app-wire-contract.md`.
  assert.equal("projectAppViews" in server, false);
  assert.equal("writeFor" in server, false);
});

test("the engine exposes no whole-app publish operation", () => {
  // `publishApp` used to live here and did deploy and publish in one write.
  // It cannot come back: a host that declares the capability would then have a
  // SECOND write path — one that skips staging and writes the `public` block
  // first, which is the ordering the design makes fail-closed. The operations
  // belong to the host; this package only says what is valid.
  assert.equal("publishApp" in server, false);
});
