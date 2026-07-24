# refactor: adopt `createSerialLock()` from gui-chat-protocol 1.2.0 (#2490)

Stage 2 of the cross-repo work in #2490. Stage 1 (upstream) is done:
`createSerialLock()` was added to `receptron/gui-chat-protocol`
(PR #27, tag `v1.2.0`, published to npm).

## Problem

`withWriteLock` — the promise-chain serialisation lock — existed
byte-identically in three places:

| Site | Why it existed |
|---|---|
| `packages/plugins/bookmarks-plugin/src/index.ts` | original (#1124 CodeRabbit review) |
| `packages/plugins/recipe-book-plugin/src/index.ts` | copied from bookmarks |
| `packages/create-mulmoclaude-plugin/src/template.ts` | scaffold template — every generated plugin inherits a fresh copy |

The duplication triage previously classified this as permanent KEEP ("the
right home is an external SDK"), but `gui-chat-protocol` is owned by the
same org, so the correct fix is to move the primitive upstream and import it.

## Plan

1. **Dep range sweep.** Every `gui-chat-protocol` declaration in the repo
   becomes `^1.2.0` — `dependencies`, `devDependencies` and
   `peerDependencies` alike, in all 24 sites across the root, the launcher,
   `packages/core` and every plugin. The three former exact pins (root,
   `packages/mulmoclaude`, `accounting-plugin`'s devDep) move to the caret
   form too, so the whole tree reads as one range. The only untouched
   occurrence is `accounting-plugin`'s `peerDependenciesMeta` entry, which
   carries `{ "optional": true }` and no version.

   `scripts/mulmoclaude/launcherSync.mjs` stays green: invariant 1 compares
   the root and launcher range strings (both `^1.2.0`), and invariants 3/5
   read the launcher pin through `parseLowerBound`, which resolves `^1.2.0`
   to `1.2.0` — so every bundled plugin's peer is still major.minor-lockstep.

   PR #2504 (`updatePackage20260724`) had bumped roughly half these sites
   ahead of this branch, leaving files that declared `^1.1.0` in one block
   and `^1.2.0` in another; this sweep is what makes the tree consistent again.

2. **Delete the three copies.** Each becomes:

   ```ts
   import { createSerialLock, definePlugin } from "gui-chat-protocol";
   …
   const withWriteLock = createSerialLock();
   ```

   The local name `withWriteLock` is kept so no call site changes. The
   comment explaining *why* serialisation is needed (parallel
   read-modify-write silently dropping an update) stays; the part
   describing the deleted implementation goes.

3. **Scaffold template.** `template.ts` embeds the plugin source as a JS
   template literal, so backticks and `${` inside it are escaped. The
   replacement text contains neither, so no new escaping is introduced.
   The template's own generated `package.json` still declared
   `gui-chat-protocol: ^0.3.0` — bumped to `^1.2.0`, otherwise a freshly
   scaffolded plugin would import a symbol its declared range cannot resolve.
   The generated README's "v0.3 runtime API" heading is corrected to v1.2 and
   gains a `createSerialLock()` bullet.

## Behaviour

Identical. The SDK implementation is the same algorithm — chain head is
`.catch(() => undefined)` so a rejected handler cannot poison the queue,
while the caller still receives its own rejection because the un-swallowed
promise is what gets returned.

## Verification

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build`
- `bookmarks` / `recipe-book` plugin tests + `create-mulmoclaude-plugin`
  template tests (the scaffold has golden template tests)
- `node scripts/mulmoclaude/launcherSync.mjs` stays green
- Runtime import check against the installed `gui-chat-protocol@1.2.0` dist,
  so the adoption isn't merely typechecking against a stale build

## Version discipline

External dep range change only. No `@mulmobridge/*` runtime export is added,
so no drift bump is required.
