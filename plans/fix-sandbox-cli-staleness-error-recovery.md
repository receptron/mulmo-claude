# fix(sandbox): document the frozen-CLI failure mode (no pin)

Issue: #2202 — the sandbox image freezes an unpinned Claude CLI, and `docker rmi`
alone cannot refresh it.

## Scope decision

Issue #2202 proposes two remedies. **Only remedy 2 (documentation) is in scope.**

- ❌ Remedy 1 — pin `@anthropic-ai/claude-code` / `tsx` in `Dockerfile.sandbox`.
  Explicitly dropped by the requester. Pinning would trade a silently-stale CLI for a
  silently-outdated pin that only moves when someone edits the Dockerfile, and it makes
  every upstream CLI fix wait on a repo change.
- ✅ Remedy 2 — make the failure self-diagnosable: put the symptom, the cause and the real
  recovery command where the agent and the reader will actually hit them.

Consequence to state honestly: **the root cause stays live.** Users still get a frozen CLI
until they run the recovery by hand. This PR only shortens the time from symptom to fix.

## Why `docker rmi` isn't enough (the non-obvious part)

`Dockerfile.sandbox:92` installs the CLI unpinned:

```dockerfile
RUN npm install -g @anthropic-ai/claude-code tsx
```

Two independent mechanisms then keep the CLI frozen:

1. `ensureSandboxImage()` (`server/system/docker.ts:87-106`) rebuilds only when the
   **Dockerfile SHA** changes. A new upstream CLI release does not change that SHA.
2. Deleting the image does **not** delete the build cache. A rebuild after `docker rmi`
   reuses the cached `npm install -g` layer (`CACHED`, 0.0s) and reinstalls nothing.
   Only `docker builder prune -a -f` invalidates it.

`docs/developer.md` currently asserts the opposite in two places — that
`yarn sandbox:remove` "forces a rebuild". That guidance is what sends users in circles,
so correcting it is the highest-value part of this change.

## Bug-family context

`handlePermission not found` is a known family with a committed matrix
(`plans/mcp-broker-availability-matrix.md`): Layer 1 = mount/resolution (cases A–I,
fixed), Layer 2 = startup race (J–L, fixed). This is a **third, distinct** root cause:
the CLI binary in the image predates the upstream fix (v2.1.206) for the cold-start
`--permission-prompt-tool` crash. Per the repo's bug-family rule, it gets a row in the
matrix rather than living only in a PR description.

## Changes

1. `packages/core/assets/helps/error-recovery.md` — new section keyed by the error string,
   with the in-image version check and the prune-based recovery. Cross-link the two
   existing sections that share the string so the agent can tell the three apart.
2. `docs/developer.md` — correct both claims that `docker rmi` / `yarn sandbox:remove`
   forces a rebuild (L186 table row, L466 sandbox section).
3. `plans/mcp-broker-availability-matrix.md` — add Layer 3 with this case, marked
   DOCUMENTED (not fixed), so the matrix doesn't read as "family fully closed".
No version bump here. `assets/helps/*` ships to npm with `@mulmoclaude/core`, so this content
does need a release to reach users — but the bump is being raised separately, so this PR leaves
`packages/core/package.json` and the launcher's dep range untouched. **The docs land in the repo
but do not reach installed users until that release goes out.**

## Verification

- `docker run --rm --entrypoint claude mulmoclaude-sandbox --version` — verified on a real
  image before documenting it (returned `2.1.214 (Claude Code)`); the entrypoint override
  is required because the image's ENTRYPOINT is `/sandbox-entrypoint.sh`.
- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / `yarn check:launcher-sync`.

## Out of scope

Pinning (remedy 1), and any change to `ensureSandboxImage()`'s rebuild trigger. If the
frozen CLI keeps biting users, the follow-up is a staleness *check* (compare in-image
version against npm's latest and warn) rather than a pin — but that's a new issue.
