# fix #1911: allowlist Firebase Web SDK apiKey in gitleaks

## User prompt (JP)

> gitleakのci、firestoreのは公開okだから別ブランチでPRつくれる？

## Context

`secret-scan` (gitleaks) has been failing on every PR — including `main` after PR #1906 (mermaid) merged — because gitleaks scans the full ref graph via `fetch-depth: 0` and picks up commit `7332183f` on the yet-to-merge branch `feat/remote-host-firestore-list-collections`. That commit adds `src/config/firebaseConfig.ts`, which contains the Firebase Web SDK config for the shared `mulmoserver` project. gitleaks' `gcp-api-key` rule fires on the `AIza…` prefix in `apiKey`.

Firebase Web SDK config is public by design:
- Google's own docs: https://firebase.google.com/docs/projects/api-keys#apikey-restrictions ("Firebase-related APIs do not use API keys for authorization").
- Access enforcement lives in Firestore Security Rules + Firebase Auth, not in secrecy of the key.
- The file header comment already states this.

## Fix

One-line addition to `.gitleaksignore` following the existing fingerprint convention:

```
7332183f0e0e6f982fc151350e5a612bc0ed9303:src/config/firebaseConfig.ts:gcp-api-key:11
```

Rationale block above the entry documents:
- Why Firebase Web SDK apiKey is not a secret (link to Google docs).
- Why the generic gitleaks rule fires anyway (the `AIza…` prefix match).
- Reminder that this is targeted — the fingerprint is scoped to that exact commit+file+line, so a NEW copy or a new leak on the same rule still surfaces.

The .gitleaksignore comment does NOT include the literal apiKey value (per the file's own instruction — gitleaks scans the ignore file too).

## Verification

Local run with gitleaks 8.30.1 (same version CI uses):

```
$ gitleaks detect --source . --redact --exit-code 1
4029 commits scanned. no leaks found.
```

## Not in scope

- No change to `src/config/firebaseConfig.ts` itself (still lives on the `feat/remote-host-firestore-list-collections` branch, will merge on its own timeline).
- No change to the gitleaks workflow — the version pin, SHA verification, and full-history scan mode stay as-is.
- No global config rework — the existing fingerprint-per-file convention is preserved.
