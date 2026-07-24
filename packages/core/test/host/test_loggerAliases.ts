// Pins the logger-alias contract from #2486: every domain's exported logger
// name must stay a pure alias of the canonical type in `@mulmoclaude/common`,
// not a copy that drifts.
//
// Each test is a two-sided pin. The ROUND-TRIP assignment chain is the
// compile-time half — an alias that gains a member breaks the assignment INTO
// it, one that loses a member breaks the assignment back OUT — and it only
// runs under `yarn typecheck` (core's tsconfig includes `test/`; `tsx --test`
// strips types without checking them). The `Object.keys` assertion is the
// runtime half, so a shape change is visible from `yarn test` too.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { MinimalLogger, StructuredLogger } from "@mulmoclaude/common";
import type { CollectionWatcherLogger } from "../../src/collection-watchers/config.ts";
import type { CollectionLogger } from "../../src/collection/server/host.ts";
import type { FeedsLogger } from "../../src/feeds/server/host.ts";
import type { GoogleLogger } from "../../src/google/host.ts";
import type { StructuredLogger as ReExportedStructuredLogger } from "../../src/host/hostSlot.ts";
import type { NotifierLogger } from "../../src/notifier/engine.ts";
import type { SchedulerLogger } from "../../src/scheduler/task-manager.ts";

const noop = (): void => {};

const STRUCTURED_METHODS = ["debug", "error", "info", "warn"];
const MINIMAL_METHODS = ["error", "info", "warn"];

test("the 4-method domain aliases are mutually assignable with StructuredLogger", () => {
  const canonical: StructuredLogger = { error: noop, warn: noop, info: noop, debug: noop };
  const reExported: ReExportedStructuredLogger = canonical;
  const collection: CollectionLogger = reExported;
  const feeds: FeedsLogger = collection;
  const google: GoogleLogger = feeds;
  const roundTripped: StructuredLogger = google;

  assert.deepEqual(Object.keys(roundTripped).sort(), STRUCTURED_METHODS);
});

test("SchedulerLogger is mutually assignable with MinimalLogger", () => {
  const canonical: MinimalLogger = { info: noop, warn: noop, error: noop };
  const scheduler: SchedulerLogger = canonical;
  const roundTripped: MinimalLogger = scheduler;

  assert.deepEqual(Object.keys(roundTripped).sort(), MINIMAL_METHODS);
});

// The two subset aliases deliberately expose FEWER methods than MinimalLogger:
// each engine only ever logs at those levels, and narrowing the injected type
// keeps a host from having to supply a level the engine never calls. Assigning
// a fresh object literal pins both directions — a missing member fails the
// assignment, an extra one trips excess-property checking.
test("NotifierLogger is the warn+error subset of MinimalLogger", () => {
  const notifier: NotifierLogger = { warn: noop, error: noop };
  const full: MinimalLogger = { info: noop, warn: noop, error: noop };
  const narrowed: NotifierLogger = full;

  assert.deepEqual(Object.keys(notifier).sort(), ["error", "warn"]);
  assert.equal(typeof narrowed.warn, "function");
});

test("CollectionWatcherLogger is the info+warn subset of MinimalLogger", () => {
  const watcher: CollectionWatcherLogger = { info: noop, warn: noop };
  const full: MinimalLogger = { info: noop, warn: noop, error: noop };
  const narrowed: CollectionWatcherLogger = full;

  assert.deepEqual(Object.keys(watcher).sort(), ["info", "warn"]);
  assert.equal(typeof narrowed.info, "function");
});
