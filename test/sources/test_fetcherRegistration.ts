// Regression guard for the bug fixed in commit 3b0613e: the fetcher
// modules self-register at import time, but nothing in the production
// boot chain imported them. `getFetcher(kind)` returned null for every
// source, the pipeline emitted 0 items, and no test failed because the
// existing pipeline tests inject a fake `getFetcher` via DI.
//
// This file imports `registerAll.ts` (the production bootstrap barrel)
// and asserts that the registry is populated for every FetcherKind the
// types module advertises. Adding a new FetcherKind without also
// registering it will now fail here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import "../../server/workspace/sources/fetchers/registerAll.js";
import { getFetcher } from "../../server/workspace/sources/fetchers/index.js";
import type { FetcherKind } from "../../server/workspace/sources/types.js";

// Kinds that MUST have a registered fetcher after importing
// registerAll.ts. FETCHER_KINDS itself also contains Claude-CLI-
// side placeholders (web-fetch, web-search) that aren't registered
// at the Node side, so we pin this list explicitly rather than
// iterating FETCHER_KINDS and letting those placeholders fail.
const EXPECTED_REGISTERED: readonly FetcherKind[] = ["rss", "github-releases", "github-issues", "arxiv"];

describe("fetcher registration (production bootstrap)", () => {
  for (const kind of EXPECTED_REGISTERED) {
    it(`has a registered fetcher for kind="${kind}"`, () => {
      const fetcher = getFetcher(kind);
      assert.ok(fetcher, `no fetcher registered for "${kind}" — did you forget to import it from server/workspace/sources/fetchers/registerAll.ts?`);
      assert.equal(fetcher!.kind, kind);
      assert.equal(typeof fetcher!.fetch, "function");
    });
  }
});
