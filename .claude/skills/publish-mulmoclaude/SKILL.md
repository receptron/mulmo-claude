---
description: Publish the `mulmoclaude` npm package — with dep audit, workspace drift check, tarball test, and cascade publish of stale @mulmobridge/* dependents
---

## Publish MulmoClaude

`mulmoclaude` is a launcher that bundles the whole app into one npm package. Unlike `/publish` (which handles a single self-contained package), this flow has three traps that bit us on 0.1.0:

1. The package's `dependencies` must cover every `import "…"` in `server/` — the root `package.json` isn't shipped, so implicit inheritance doesn't exist.
2. `@mulmobridge/*` workspace packages can drift — local `src/` adds exports without a version bump, so `npm install` resolves to an older published `dist/` that's missing them. All dependents fail at runtime.
3. `prepare-dist.js` runs via `prepublishOnly`, so `npm publish` already invokes it — but you still need `yarn build` first (for `dist/client/`) and `yarn build:packages` if any workspace package was bumped.

Run every step; a "ready banner + HTTP 200" in /tmp is the go/no-go.

### 0. Preconditions

- On a branch (never main), clean working tree or deliberate uncommitted changes only.
- Logged in: `npm whoami`.

```bash
git status
npm whoami
```

### 1. Dependency audit (catches "ERR_MODULE_NOT_FOUND at runtime")

Compare bare imports under `server/` with what `packages/mulmoclaude/package.json` declares. Anything missing must be added.

```bash
python3 <<'PY'
import json, re, os
root = '.'
pkg = json.load(open(f'{root}/packages/mulmoclaude/package.json'))
have = set(pkg.get('dependencies', {}).keys())

# Extract the `from "..."` specifier from every top-level
# import / export-from. Two passes:
#   1. Single-line imports  — `import X from "pkg"` or
#                              `export { a } from "pkg"`
#   2. Multi-line imports   — `import {\n  a, b,\n} from "pkg"` etc.
# Anything else (comments, Array.from, string literals) is ignored.
SINGLE = re.compile(
    r"^\s*(?:import|export)\b[^{\n]*\sfrom\s+['\"]([^./][^'\"]*)['\"]",
    re.MULTILINE,
)
MULTI = re.compile(
    r"^\s*(?:import|export)\s*\{[^}]*\}\s*from\s+['\"]([^./][^'\"]*)['\"]",
    re.MULTILINE | re.DOTALL,
)
imports = set()
for dirpath, _, files in os.walk(f'{root}/server'):
    if 'node_modules' in dirpath: continue
    for f in files:
        if not f.endswith('.ts'): continue
        with open(os.path.join(dirpath, f)) as fh:
            txt = fh.read()
        for rx in (SINGLE, MULTI):
            for m in rx.finditer(txt):
                name = m.group(1)
                imports.add('/'.join(name.split('/')[:2]) if name.startswith('@') else name.split('/')[0])

builtins = {'fs','path','os','http','url','util','stream','net','crypto','child_process','events','zlib','module'}
missing = sorted(n for n in imports if n not in have and n not in builtins and not n.startswith('node:'))
print('MISSING from mulmoclaude deps:', missing or 'none')
PY
```

For each missing package, read the root `package.json` for the version and add it to `packages/mulmoclaude/package.json`.

### 2. Workspace drift check (catches "X does not provide an export named Y")

If local `packages/<name>/src/` has more exports than the already-published `dist/`, mulmoclaude will resolve the published (stale) build at runtime and fail. Check each workspace package mulmoclaude depends on:

```bash
# Count only runtime (value) exports. TS `export type …` / `export
# interface …` disappear at compile time, so counting them in src/
# would always look "drifted" vs dist/.
count_value_exports() {
  # strips type-only lines, then counts remaining `^export` occurrences
  grep -E '^export' "$1" 2>/dev/null \
    | grep -Ev '^export (type|interface)\b' \
    | grep -Ev '^export \{ *type\b' \
    | wc -l | tr -d ' '
}

for pkg in protocol client chat-service; do
  local=$(jq -r .version packages/$pkg/package.json)
  remote=$(npm view @mulmobridge/$pkg version 2>/dev/null)
  local_ex=$(count_value_exports "packages/$pkg/src/index.ts")
  pub_ex=$(count_value_exports "node_modules/@mulmobridge/$pkg/dist/index.js")
  # Flag a drift only when local source has MORE value exports than the
  # currently-installed dist — that's the scenario where consumers will
  # crash with "does not provide an export named X".
  flag=""
  [ -n "$local_ex" ] && [ -n "$pub_ex" ] && [ "$local_ex" -gt "$pub_ex" ] && flag=" ⚠ DRIFT"
  echo "@mulmobridge/$pkg: ver local=$local registry=$remote, value-exports local=$local_ex pub=$pub_ex$flag"
done
```

The `⚠ DRIFT` flag is the signal that the package needs a bump + republish before mulmoclaude can be published. No flag = good to ship.

For each drifted package (local exports > pub exports, OR versions match but source ≠ published):

```bash
# Bump in that package's package.json, then:
yarn install
yarn build:packages
cd packages/<name> && npm publish --access public
# Tag + GitHub release: see §7.
```

Update mulmoclaude's refs to the new versions. If `chat-service` depends on `protocol`, bump its dep there too.

### 3. Build

```bash
yarn install         # picks up any new deps from §1
yarn build           # builds workspace packages AND dist/client (Vite)
```

### 4. Local tarball test — MANDATORY before publish

`prepare-dist` runs via `prepublishOnly`, so `npm pack` exercises the exact same flow. Test the tarball in a clean dir to catch runtime issues (missing dep, export drift, …) before they hit the registry.

```bash
cd packages/mulmoclaude && rm -f mulmoclaude-*.tgz && npm pack
# → mulmoclaude-<X.Y.Z>.tgz

rm -rf /tmp/mc-test && mkdir /tmp/mc-test && cd /tmp/mc-test
npm init -y >/dev/null
npm install /abs/path/to/mulmoclaude-<X.Y.Z>.tgz
./node_modules/.bin/mulmoclaude --no-open --port 3097 &
LAUNCHER=$!
# wait up to 20 s for the ready banner, then probe /
( while ! curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3097/ 2>/dev/null | grep -q 200; do sleep 1; done; echo OK )
kill $LAUNCHER
```

Expected: **`✓ MulmoClaude is ready` banner + `HTTP 200`**. Any ERR_MODULE_NOT_FOUND, export errors, or port crashes → stop and fix before publishing.

### 5. Test-only version rule

When iterating (known-broken 0.1.0 → fixed 0.1.1), keep the published version on a throwaway `0.1.x` line and **don't commit the bumps** until a real test-passed version is confirmed. The `console.log("mulmoclaude X.Y.Z")` string inside `bin/mulmoclaude.js` must match the `package.json` version — update both together (both uncommitted while iterating).

### 6. Publish

```bash
cd packages/mulmoclaude && npm publish --access public
```

Verify:

```bash
npm view mulmoclaude version
rm -rf /tmp/npx-fresh && mkdir /tmp/npx-fresh && cd /tmp/npx-fresh
npx --yes mulmoclaude@<X.Y.Z> --version
```

### 7. Tag + GitHub release (only for @mulmobridge/* packages that were cascade-bumped)

The user has said that `mulmoclaude`'s own launches don't need GitHub releases yet. Only publish releases for the dependent packages that got bumped in §2.

```bash
# Per bumped package:
git tag "@mulmobridge/<name>@<X.Y.Z>"
git push origin "@mulmobridge/<name>@<X.Y.Z>"
gh release create "@mulmobridge/<name>@<X.Y.Z>" \
  --generate-notes --latest=false \
  --title "@mulmobridge/<name>@<X.Y.Z>" \
  --notes "$(cat <<'EOF'
## Highlights

- <what changed — one or two bullets>

📦 **npm**: [`@mulmobridge/<name>@<X.Y.Z>`](https://www.npmjs.com/package/@mulmobridge/<name>/v/<X.Y.Z>)

---

EOF
)"
```

`--latest=false` is mandatory for package releases so they don't displace the latest `vX.Y.Z` app release.

### 8. Commit + PR

Commit the real (non-test) version bumps + dep additions, push to a feature branch, open a PR. Never push directly to main.

```bash
git add packages/protocol/package.json packages/chat-service/package.json \
        packages/mulmoclaude/package.json packages/mulmoclaude/bin/mulmoclaude.js \
        yarn.lock
git commit -m "fix(mulmoclaude): <what>"
git push -u origin <branch>
gh pr create --title "..." --body "..."
```

### Lessons that drove this skill (keep in mind when extending it)

- First publish of `mulmoclaude@0.1.0` crashed with `ERR_MODULE_NOT_FOUND: mulmocast` → §1 exists.
- Reinstall of `@mulmobridge/protocol@0.1.2` returned a build without `GENERATION_KINDS` even though the local source had it → §2 exists.
- `Port 3001 is already in use` silently timed out the ready poll → 0.1.2 added port fallback. If you see similar "ready never fires" reports, check for a port conflict first.
- A test publish on `0.1.x` should never land as a committed version on the branch — §5.
