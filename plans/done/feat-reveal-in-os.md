# feat: Reveal file in OS file manager ("ファイルの場所を開く") — #1985 follow-up

## Background

#1985 (PR #1988) added an **"OS で開く" (Open in OS)** button on the binary /
unsupported-preview fallback in the Files view. It launches the host's default
handler for the file (`open` / `xdg-open` / `explorer.exe`).

@ystknsh followed up asking for **"Finder で表示（ファイルの場所を開く）"** — a
button that opens the file's *containing folder* (with the file selected where
the platform supports it) so a generated xlsx can be dragged into another system
(e.g. the tax-return upload form).

## Scope

Add a second button next to "Open in OS" that reveals the file's location.

- **macOS**: `open -R <absPath>` — reveals & selects the file in Finder.
- **Windows**: `explorer.exe /select,<absPath>` — opens Explorer with the file selected.
- **Linux**: `xdg-open <dirname>` — opens the containing folder (no portable
  "select the item" across the many Linux file managers; landing next to the
  file is enough for drag-and-drop).

Label is OS-neutral to match the existing "Open in OS" convention (not
"Finder"-specific), since the same button serves all three platforms.

## Changes

1. **server/api/routes/files.ts**
   - Extract shared `spawnDetachedOsCommand(command, args, label)` from
     `openInHostOs` (DRY: same spawn/error-vs-spawn detection).
   - Add `revealInHostOs(absPath)` using the per-platform reveal commands above
     (`path.dirname` already available via the `path` import).
   - Extract `handleOsFileAction(req, res, action, failureMessage)` shared by the
     open + reveal routes (identical path-validation + response shape).
   - Add `POST /api/files/reveal`.

2. **src/config/apiRoutes.ts** — add `files.reveal: "/api/files/reveal"`.

3. **src/composables/useOpenInOs.ts**
   - Extract private generic `useFileOsAction(selectedPath, route, fallback)`.
   - Keep `useOpenInOs` (unchanged public shape `{busy,error,open}`).
   - Add `useRevealInOs` (`{busy,error,reveal}`).

4. **src/components/FileContentHeader.vue** — "Show in folder" icon button
   (`folder_open`, `data-testid="file-reveal-in-os"`). Placed in the header
   (always rendered when a file is selected) so it works for **every** file
   type — text / markdown / json / html, not just the binary fallback. Error
   surfaces via the button `title` + red tint (the header is a single row).

5. **i18n (all 8 locales)** — add `fileContentHeader.revealInOs` /
   `revealInOsFailed`.

6. **Tests**
   - `test/routes/test_filesRoute_reveal.ts` — mirrors the open route test.
   - Extend `test/composables/test_useOpenInOs.ts` with `useRevealInOs` coverage
     (posts to `/api/files/reveal`).

## Notes / decisions

- Security: same argv-array (no shell) discipline as #1988 — the codex/codeql
  fix. The path never travels through a shell parser on any platform.
- `explorer.exe` returns exit code 1 even on success, so success is detected via
  the `spawn` event, not process exit (unchanged from #1988).
