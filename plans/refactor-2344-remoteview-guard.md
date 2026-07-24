# refactor: centralise the remote-view mobile-target guard

Issue: #2345 (branch/worktree were numbered `2344`; see "Issue numbering" below)

## Context

`jscpd` flagged the same three lines at the head of all three exported factories
in `server/workspace/collections/remoteView.ts` (alerts #375 / #302, 62 tokens
each):

| Factory                  | Entry point it backs                                  |
| ------------------------ | ----------------------------------------------------- |
| `createBuildRemoteView`  | `getRemoteView` channel handler + preview HTTP route  |
| `createMutateRemoteView` | `mutateRemoteViewItem` handler + `…/mutate` route     |
| `createRemoteViewItems`  | `getRemoteViewItems` handler + `…/items` route        |

```ts
const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
if (!view) return { kind: "view-not-found", viewId };
if (view.target !== "mobile") return { kind: "not-mobile", viewId };
```

## Why this is worth fixing

`view.target !== "mobile"` is not a formatting nicety — it is an **access
decision**. A desktop view's HTML is written against the token/dataUrl contract
(it fetches `/api/files/raw` with a scoped token); served to a phone it would
render broken, so the host refuses it rather than shipping a broken page.

Hand-copied into three entry points, the guard is one forgotten line away from a
fourth remote-view operation being exposed without it. Centralising makes the
guard structurally unavoidable: a new operation cannot resolve a view without
passing through it.

Only `createBuildRemoteView` carried the comment explaining *why* the guard
exists. Moving that comment onto the shared helper makes the WHY apply to every
path instead of one of three.

## What this changes

- New exported `resolveMobileView(collection, viewId): ResolveMobileViewResult`
  in the same module, holding the lookup, both refusals, and the WHY comment.
- The three factories replace their opening three lines with:
  ```ts
  const resolved = resolveMobileView(collection, viewId);
  if (resolved.kind !== "ok") return resolved;
  const { view } = resolved;
  ```
- No behaviour change: same lookup, same order (`view-not-found` before
  `not-mobile`), same result objects.

`(collection.schema.views ?? [])` is preserved verbatim — `views` is
`z.array(CustomViewZ).optional()`, so a collection that declares no views has
`schema.views === undefined` and the fallback is what keeps this a
`view-not-found` instead of a `TypeError`.

## Result-type compatibility

The helper's two non-ok members had to stay assignable to all three existing
public result types, without widening any of them. Checked before designing:

| Member                                     | `RemoteViewBuildResult` | `MutateRemoteViewResult` | `RemoteViewItemsResult` |
| ------------------------------------------ | ----------------------- | ------------------------ | ----------------------- |
| `{ kind: "view-not-found"; viewId: string }` | yes                   | yes                      | yes                     |
| `{ kind: "not-mobile"; viewId: string }`     | yes                   | yes                      | yes                     |

Identical in all three, so `return resolved;` after a `kind !== "ok"` narrowing
type-checks at every call site with no adapter and no public type widened.

The `ok` branch carries a plain `CollectionCustomView` (as the issue proposes).
A `CollectionCustomView & { target: "mobile" }` intersection was considered and
rejected: no caller reads `view.target` (`createBuildRemoteView` writes the
`"mobile"` literal into `RemoteViewInfo`), so it would add a type plus a type
predicate for zero consumer benefit.

## Tests

New `test/remoteHost/test_resolveMobileView.ts` covers the helper directly:
`views` undefined, `views` empty, id not matched, `target: "desktop"`, `target`
absent, plus the happy path (and that lookup precedes the target check).

The per-factory "the guard still fires through this entry point" tests already
exist and are **not** duplicated — they are the regression net that protects
against a future fourth caller:

| Factory                  | Existing test                                                                  |
| ------------------------ | ------------------------------------------------------------------------------ |
| `createBuildRemoteView`  | `test_getRemoteView.ts` — "refuses an unknown view, a desktop view, …"          |
| `createMutateRemoteView` | `test_mutateRemoteView.ts` — "refuses a read-only mobile view, a desktop view…" |
| `createRemoteViewItems`  | `test_remoteViewItems.ts` — "refuses an unknown view and a desktop view"        |

## Verification

Mutation-checked, not just "tests pass": with `if (view.target !== "mobile")`
deleted from the helper, the new helper tests and all three per-factory guard
tests must go **red**; restoring it returns them to green.

## Issue numbering

This work was scheduled as `2344` (worktree, branch, and this file's name), but
the content it implements is issue **#2345**
(`refactor(remoteView): the mobile-target guard is hand-copied into three entry
points`). Issue #2344 is the unrelated frontend mutation-queue dedup, handled on
`refactor/2345-mutation-queue` — the two branch names are swapped relative to
their issues. The filename is left as-is so it matches the branch it ships on;
the PR closes #2345.
