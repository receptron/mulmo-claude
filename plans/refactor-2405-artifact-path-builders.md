# refactor(#2405): single-source artifact path builders in `@mulmoclaude/core`

## Problem

The artifact-save path assembly (`artifacts/<kind>/YYYY/MM/<slug>-<ts>.<ext>` plus the
containment / traversal guard) is copied — same shape — across three plugins'
`src/core/paths.ts`:

- `chart-plugin`  → `slugify`, `yearMonthUtc`, `chartArtifactPath`
- `html-plugin`   → `slugify`, `yearMonthUtc`, `htmlArtifactPath`, plus the `""`/`.`/`..`
  segment check inside `isHtmlArtifactPath` / `htmlArtifactPreviewUrl`
- `mulmoscript-plugin` → `slugify`, `storyFilePath`, plus the same segment check inside
  `normalizeStoryPath`

jscpd flags 96 / 83 / 50 duplicated tokens. The security concern (issue #2405): the
path assembly encodes a **workspace-escape** judgement — if one of the three copies
drops a normalisation step, only that copy becomes escapable. Cross-plugin sharing must
go through core (CLAUDE.md dependency-direction rule); plugins must not copy or import
from each other.

## Approach

Add a new **browser-safe** core subpath `@mulmoclaude/core/artifacts`
(`packages/core/src/artifacts/paths.ts`) with the shared primitives, then reduce each
plugin's `paths.ts` to thin wrappers that import them.

### Core module — `@mulmoclaude/core/artifacts`

| export | purpose |
|---|---|
| `ARTIFACTS_ROOT` | the `"artifacts"` workspace root segment |
| `slugifyArtifact(title, fallback)` | canonical lowercase-ASCII slug, ReDoS-safe linear scan, 120-char cap |
| `yearMonthUtc(now?)` | UTC `YYYY/MM` partition (#764 sharding) |
| `buildArtifactRelPath({dir,title,ext,fallback,now?,partitioned?})` | FileOps-relative `<dir>[/YYYY/MM]/<slug>-<epochMs><ext>` |
| `toWorkspaceArtifactPath(relPath)` | prefix a FileOps-relative path with `artifacts/` |
| `hasUnsafePathSegment(value)` | shared traversal guard: true if any `/`-segment is `""`, `.`, or `..` |

### Plugin wrappers (behaviour identical)

- **chart**: `chartArtifactPath(title)` → `buildArtifactRelPath({dir:"charts", ext:".chart.json", fallback:"chart", partitioned:true})` + `toWorkspaceArtifactPath`. Keep the `slugify` re-export (default fallback `"chart"`) delegating to `slugifyArtifact`.
- **html**: `htmlArtifactPath(title)` likewise (`dir:"html"`, `ext:".html"`, fallback `"page"`). `isHtmlArtifactPath` / `htmlArtifactPreviewUrl` keep their html-specific rules but call `hasUnsafePathSegment` for the segment check. `toArtifactsRelative` stays local (html-specific). Keep `slugify` re-export.
- **mulmoscript**: `storyFilePath(slugSource)` → `buildArtifactRelPath({dir:"stories", ext:".json", fallback:"story", partitioned:false})` (stories are NOT `YYYY/MM`-partitioned and the wire path has no `artifacts/` prefix). `normalizeStoryPath` keeps its alias/absolute/backslash rules but calls `hasUnsafePathSegment`. Keep `slugify` re-export.

## Key decisions

1. **Browser-safe, no `node:path`.** The plugins' `./vue` browser entry transitively
   imports `core/paths.ts` (e.g. `htmlArtifactPreviewUrl` in `View.vue`), and each plugin
   externalises `@mulmoclaude/core`, so the host's browser build resolves this subpath
   exactly like `@mulmoclaude/core/collection`. These are **POSIX wire paths** (stored in
   JSON, used as FileOps keys) that must always use `/`. `path.join` would emit `\` on
   Windows and break them; `path.posix.join` needs `node:path`, which the existing
   deliberately-browser-safe modules avoid. So the core module joins already-sanitised
   segments with `/`, matching the documented existing design and the
   `@mulmoclaude/core/workspace-setup/slug` browser-safe precedent.
2. **One canonical `slugifyArtifact`** uses chart's strip → cap → strip order. html /
   mulmoscript previously capped before stripping; the two orders differ only for titles
   that start with punctuation AND exceed 120 chars (documented in `docs/shared-utils.md`).
   Pinned by a boundary test.
3. **Host `server/utils/files/naming.ts` left untouched** (no 4-way merge). Its
   `buildArtifactPath` uses the host `slugify` with a crypto hash fallback for non-ASCII
   titles — semantically different from the plugins' simpler ASCII-word fallback. Folding
   it in would change behaviour, so it stays out of scope (spreadsheet/document/image
   naming rides on it).

## Version discipline

- Bump `@mulmoclaude/core` `1.1.0 → 1.2.0` (new subpath export = minor).
- Add `@mulmoclaude/core: ^1.2.0` as a **dependency** to chart / html / mulmoscript, and
  add `/^@mulmoclaude\/core/` to each plugin's vite `external` (host provides one core
  instance — mirrors google / collection plugins).
- Sweep every existing `@mulmoclaude/core` range to `^1.2.0` (collection-plugin dep +
  devDep, google-plugin, launcher) so the internal-dep-range rule + `launcherSync`
  workspace-lockstep invariant (`launcherRange.lowerBound == workspace.version`) stay
  green. Do **not** bump the launcher's own `version`.

## Tests

- `packages/core/test/artifacts/test_paths.ts` — pure-function tests for
  `slugifyArtifact` (happy / empty / non-ASCII / punctuation / 120-boundary),
  `yearMonthUtc`, `buildArtifactRelPath` (partitioned + non-partitioned + nested),
  `toWorkspaceArtifactPath`, `hasUnsafePathSegment` (`.`/`..`/empty/traversal).
- Existing plugin path tests (`html`, `mulmoscript`) keep passing unchanged — they import
  through the plugin source, proving the wrappers are behaviour-preserving.

## Verify

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`, plus the core
package's own `yarn test`.

## Docs

Update the `slugify` and `yearMonthUtc` rows in `docs/shared-utils.md` to record the
resolution, and append a one-line `@mulmoclaude/core/artifacts` entry.
