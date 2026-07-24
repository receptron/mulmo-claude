# fix(#1863): long-message render truncation to prevent Safari freeze

## Summary

When Opus 4.8 hits its degenerate-repetition bug (produces hundreds of thousands of chars of blank-line-separated single words), rendering the resulting message through `marked()` in `src/plugins/textResponse/View.vue` produces tens of thousands of `<p>` block elements. `marked` itself is fast (~120ms per the issue's measurement), but Safari's layout / paint on 24k–31k `<p>` per message freezes the tab for minutes. Chrome tolerates it in a few seconds; Safari doesn't.

**Fix**: cap the string we feed into `marked()` at 100k chars. When the assistant message exceeds that, we render only a 20k-char preview slice and show a banner explaining the truncation. The raw text is preserved in the jsonl and still reachable via the existing Copy button — no data loss.

Deliberately picked defensive rendering over generation-time detection:
- Existing broken sessions on users' disks are the immediate pain (opening the tab is what freezes Safari). Rendering-side cap fixes those retroactively.
- Generation-side runaway detection is a follow-up: model-bug detection is fuzzy (a legitimate long list can look like repetition) and doesn't help sessions that already contain the bad payload.

## Items to Confirm / Review

- [ ] **Threshold 100_000 chars** — well beyond a normal Claude reply (Claude's ~200k token ceiling maps to ~800KB textish, but individual assistant messages in typical sessions are 5–50KB). Set it higher if long docs occasionally trip it, lower if we want more aggressive truncation.
- [ ] **Preview slice 20_000 chars** — deliberately small so even a fully-blank-line-separated payload stays under ~a few thousand block elements. Users get "Copy" for the full raw text.
- [ ] **JSON-in-code-fence skipping when truncated** — a partial JSON payload no longer wraps in ` ```json ` because `JSON.parse` on a truncated tail would throw; the preview renders as plain markdown. Feels right, but worth flagging.
- [ ] **i18n key added to all 8 locales** in lockstep — key `pluginTextResponse.truncatedForRender` with `{omitted}` + `{total}` placeholders.
- [ ] **Seeded user turn (`isSeededUserTurn` branch)** currently uses the same `renderedHtml`; the banner won't render there because the seeded card's template block doesn't include it. Seeded prompts are always short so this is fine, but let me know if we want the banner there too.

## User Prompt

> Bug で優先度高くて対応したほうが良いのを順次。
> あと、閉じたissueはreporterをメンションして確認してもらうように。

## Implementation

- `src/plugins/textResponse/utils.ts` — new pure helper `truncateForRender(text)` returning `{ displayText, wasTruncated, originalChars, omittedChars }`. Constants exported for tests.
- `src/plugins/textResponse/View.vue` — `truncationInfo` computed, `renderedHtml` reads its `displayText`, template renders a banner via `t("pluginTextResponse.truncatedForRender", { ... })` when `wasTruncated`.
- `src/lang/{en,ja,de,es,fr,ko,pt-BR,zh}.ts` — `truncatedForRender` key added, all 8 locales in lockstep.
- `test/plugins/textResponse/test_utils.ts` — 4 new tests: below cap → passthrough, exactly at cap → passthrough, runaway "court\n\n" × 30k → truncated to preview slice, empty → empty result.

## Test plan

- [x] `yarn tsx --test test/plugins/textResponse/test_utils.ts` — 13 pass (9 existing + 4 new).
- [x] `yarn format` / `yarn lint` (0 errors, 26 pre-existing warnings) / `yarn typecheck` / `yarn build`.
- Manual e2e (Safari, once merged): open a saved session known to contain the degenerate output. Tab should render in under a second with the banner instead of freezing for minutes. Copy button still returns the full raw text.

## Out of scope

- **Generation-side runaway detection** (`server/agent/…` streaming abort on repeat-word pattern). Real value but not urgent — the render-side cap already recovers UX for both existing and future sessions. Follow-up issue if we want to stop the underlying corruption from landing in jsonl at all.
- **Tool-call reconstruction** — the issue mentions `<invoke>` becoming text when the model breaks. That's a server-side agent-loop concern (parse tool-use from streaming); different subsystem, different PR.
