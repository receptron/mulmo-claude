# markdown-utils — mermaid trio (idPrefix parameterization)

Final markdown/image dedup between host and markdown-plugin. Moves the mermaid RENDERER
into `@mulmoclaude/markdown-utils`, bumping it `1.1.0 → 1.2.0`.

## What moves (host canonical)

- **`markdown/mermaidRender.ts`** — the DOM scanner + lazy mermaid-runtime loader + SVG
  adoption. The ONLY host↔plugin functional difference was the per-diagram DOM id prefix
  (`mulmo-mermaid` vs `mulmo-mermaid-plugin`, to avoid id collisions when both render on
  one page). Parameterized: `renderMermaidNodes(root, labels?, idPrefix = "mulmo-mermaid")`
  threads `idPrefix` → `renderOne` → `nextRenderId`.
- **`markdown/mermaidExtension.ts`** — comment-only drift, moved as-is.
- Added `mermaid` to the package peer/dev deps (lazy-imported by mermaidRender).

## What stays per-side (deliberately)

- **`useMermaid.ts`** — the thin Vue composable. Host wires `vue-i18n`
  (`useI18n` → `markdownMermaid.*` keys); the plugin wires its OWN i18n (`useT` →
  `mermaid*` keys). The i18n plumbing is genuinely environment-specific, so each side keeps
  its ~25-line composable — it just resolves labels and calls the shared
  `renderMermaidNodes`. The plugin's copy passes `"mulmo-mermaid-plugin"` to preserve its
  prefix; the host uses the default.

## Behavior preservation

Both sides keep their exact original id prefixes (host `mulmo-mermaid-N`, plugin
`mulmo-mermaid-plugin-N`). The prefix only feeds `mermaid.render(svgId, …)` (the invisible
SVG root id), so rendering is visually identical. Rendering logic is byte-identical to the
prior host module. Redundant `test/plugins/markdown/test_mermaidRender.ts` (a near-dup of
the host test, both only exercised `adoptSvg`) deleted; the host tests now cover the package.

## Version

Clean MINOR (1.2.0) — `^1.0.0`/`^1.1.0` consumers pick it up with no sweep; launcher +
markdown-plugin ranges bumped `^1.2.0` for hygiene.

## jscpd (spreadsheet excluded)

2163 → **2036 duplicated lines (1.80% → 1.69%)**.

## Verify

build:packages + full vite build EXIT 0 · typecheck EXIT 0 · lint 0 new · mermaid unit
tests 15/15. **App-level `/verify` (mermaid renders on a wiki/skill page) is user-triggered
and could not be run by the agent — recommended before merge; CI e2e also exercises the
rendering path.**

## Release prerequisite

Publish `@mulmoclaude/markdown-utils@1.2.0` before the launcher / markdown-plugin republish.

## Remaining

`errors` deliberately NOT consolidated (a `@mulmoclaude/core/utils` concern; ~25 lines not
worth pulling core into the plugin). The markdown-utils dedup is otherwise complete.
