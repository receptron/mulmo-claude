# fix: Docker credential refresh — posix_spawnp failure (2-bug chain)

Issue: receptron/mulmoclaude#2265

## Symptom

On `useDocker && darwin`, every agent run logs and fails:

```
[credentials] Access token expired (could not parse expiry), launching claude CLI to renew...
[credentials] Failed to refresh credentials from Keychain error="Error: posix_spawnp failed."
```

`npx mulmoclaude@latest` (published 1.4.0) shows neither line; local dev (same "1.4.0" but 76 commits ahead) reproduces both.

## Root causes (a chain — ① is the trigger, ② the dormant fault ① exposes)

**① Code regression (`40fdb7d8`).** `readExpiresAt()` ended with
`typeof oauth.expiresAt === "string" ? oauth.expiresAt : null`, but the macOS
Keychain stores `claudeAiOauth.expiresAt` as a **number** (epoch ms). So it
always returned `null` → `isTokenExpired()` always `true` → a valid token was
treated as expired and a PTY renew fired on every run. Published 1.4.0 predates
this and used `new Date(expiresAt)` (number-safe), so it never entered the renew
path — which is why npx never hit ② either.

**② Packaging.** The renew spawns `claude` through node-pty, which first execs
`node_modules/node-pty/prebuilds/<platform>/spawn-helper`. node-pty's npm
tarball ships that prebuilt binary mode **644** (verified: `npm pack
node-pty@1.1.0`), and neither npm nor yarn adds the executable bit — so the exec
fails EACCES and node-pty throws `posix_spawnp failed`. Reproduced with a
harmless `echo` spawn; `chmod +x` fixes it. `npx mulmoclaude@latest` avoids the
error only because it lacks bug ① and never enters the renew path — ① was the
sole guard. (mulmoterminal already carries the same fix in
`server/fix-pty-perms.js`; mulmoclaude was simply missing it.)

## Fix

- **①** `readExpiresAt` returns `number | null` (epoch ms), accepting both a
  numeric and an ISO-string `expiresAt`. `isTokenExpired` + the two log sites
  follow the numeric type; logs format via `new Date(ms).toISOString()`.
  Exported for direct testing. Regression tests added in
  `test/system/test_credentials.ts` (number / ISO / missing / bad-JSON / wrong
  type).
- **② (durable)** Restore `+x` on every `node-pty/prebuilds/*/spawn-helper` via
  a `postinstall`, in two places:
  - `scripts/fix-node-pty-perms.mjs` at the monorepo root (dev installs).
  - `packages/mulmoclaude/bin/fix-node-pty-perms.mjs` in the published launcher
    (a self-contained copy, since the package can't reach the root script), so
    npm/npx users' renews succeed when their token genuinely expires.
  Both are idempotent; no-op when node-pty is absent or ships no spawn-helper
  (Windows). Self-heal across reinstalls.

## Notes

- `mulmoterminal` also depends on `node-pty ^1.1.0` and already fixes ② in
  `server/fix-pty-perms.js`; its fix covers its own PTY but not the separate
  node-pty of the mulmoclaude server it launches — cross-referenced in its repo.
