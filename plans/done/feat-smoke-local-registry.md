# feat: Decouple the `smoke` tarball test from public npm (eliminate publish-before-merge)

## Problem

A PR that bumps a launcher-pinned shared `@mulmoclaude/*` package **cannot go
green without publishing that package to public npm first** — a chicken-and-egg
with the ideal "publish from `main` after merge" release flow.

Root cause: the `smoke` job (`scripts/mulmoclaude/tarball.mjs`) `npm pack`s the
launcher and `npm install`s the `.tgz` into a clean dir via
`{ mulmoclaude: "file:<tgz>" }`. That install resolves the launcher's
`@mulmoclaude/*` **dependencies from the public npm registry** (a real end-user
install, no workspace fallback). So a launcher pinned to an unpublished
`@mulmoclaude/core@^0.12.0` / `collection-plugin@^0.7.3` fails with
`ETARGET No matching version found` → smoke red. (Hit in PR #1993; the
launcher-sync gate stayed green because it is npm-agnostic — only `smoke` forces
the publish.)

## Goal

A PR can bump + validate a shared-package version **without** publishing to public
npm. Public publish moves to a clean post-merge release step.

## Chosen approach — npm `overrides` → locally-packed `.tgz` (IMPLEMENTED)

Considered a Verdaccio throwaway local registry (highest fidelity, but adds a
service + auth-token/`.npmrc` scoping to the CI job). Chose the **service-free
`overrides`** path: pure npm, no extra process, a targeted change to
`scripts/mulmoclaude/tarball.mjs` + its unit tests.

De-risked first: a synthetic repro confirmed npm resolves a **transitive** `file:`
override for an unpublished-scope package fully offline (npm ≥ 8.3). Then built:

- `enumerateWorkspacePackages(root)` — expand the root `workspaces` globs (all
  `<dir>/*`) to `{ name, dir, private, deps }` per package (`deps` folds
  dependencies + peer + optional).
- `computeFirstPartyClosure(packages, "mulmoclaude")` — pure BFS for the launcher's
  transitive **first-party** (workspace) deps, so third-party deps
  (`@mulmochat-plugin/*`, `@mulmocast/types`, …) are left to the real registry.
  Against the real repo this is **13 packages** (core, the bundled plugins, the
  bridges, task-scheduler), not all 47 workspace packages.
- `packWorkspaceOverrides(...)` — `npm pack --ignore-scripts` each closure package
  (dist is already built by the workflow's `yarn build:packages`, so no prepack
  rebuild) into a temp dir; returns an `overrides` map `{ name: "file:<abs.tgz>" }`.
- `buildInstallerPackageJson({ tarballName, overrides })` — emits the `overrides`
  block; `installTarball` writes it before `npm install`, so first-party deps
  resolve from the just-built workspace instead of the public registry.

`scripts/` is not covered by `yarn lint`; the pure helpers are unit-tested in
`test/scripts/mulmoclaude/test_tarball.ts` (closure BFS, overrides shape, the pack
loop with injected fakes, real-repo enumeration). The full install+boot is exercised
by the `smoke` job itself, which `paths`-triggers on `scripts/mulmoclaude/**`.

## The fidelity tradeoff (accepted by the maintainer)

`smoke` **no longer catches "you forgot to publish a first-party dep"** — it always
installs the local build. That check lives in the release/publish step (the
`/publish` skill verifies a package's deps are published before publishing it).
Signed off for this change.

## Non-goals

- Not changing what `smoke` asserts post-install (boot → `/` 200, sandbox files,
  plugin list) — only *where the first-party deps come from*.
- Not touching the launcher-sync gate (already npm-agnostic and correct).

## Provenance

Split out of PR #1993 (remote offline queue). See the "Implementation order"
note in `plans/done/feat-remote-offline-queue.md` and the memory
`feedback_bump_in_pr_publish_after_merge` for the constraint this removes.
