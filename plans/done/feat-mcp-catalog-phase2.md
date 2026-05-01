# MCP catalog Phase 2 — per-server config + 6 new entries

GitHub: https://github.com/receptron/mulmoclaude/issues/823 (continued from #825)

## Outcome

Phase 1 (#825) shipped 7 config-free entries. Phase 2 closes the
"general user" gap with:

1. **Per-server config UI** — fields described by `configSchema`
   are rendered as a form; `${VAR}` placeholders in the spec
   template are interpolated at install time. Required-field
   validation. `🔑` link beside fields with `helpUrl`.
2. **6 new catalog entries**, all general audience, covering the
   docs / info-gathering / general-task buckets the v1 was
   missing:
   - `context7` (library docs lookup, config-free, stdio)
   - `deepwiki` (GitHub repo wiki, config-free, HTTP)
   - `notion` (Notion DB, requires API key)
   - `slack` (channels / messages, requires bot token + team id)
   - `google-maps` (places / routing, requires API key)
   - `weather-open-meteo` (forecast / current, config-free, stdio)

## Out of scope

- GitHub, Obsidian, Browser/Puppeteer (user excluded explicitly)
- Developer-audience section (still deferred to a later phase
  per the original v1 scoping)
- Edit-after-install for catalog entries — v2 keeps the
  remove-and-re-add UX of v1; reconfiguring an installed catalog
  entry currently requires uninstall + reinstall. Drafted values
  are kept in localStorage so a re-toggle pre-fills the form.

## Implementation steps

1. **Schema interpolation** — pure helper
   `src/utils/mcp/interpolateSpec.ts` that walks the
   `McpServerSpec` and substitutes `${VAR}` inside `command`,
   `args`, `env` values, `url`, `headers` values. Reject (return
   error) when a placeholder has no matching value and the field
   is `required: true`.
2. **Form rendering** in `src/components/SettingsMcpTab.vue`:
   - On checkbox toggle ON, if `configSchema.length > 0` expand
     an inline form below the entry instead of installing
     immediately.
   - Fields: `text` / `secret` (password input) / `path` /
     `url` / `select`. `🔑` link per field for `helpUrl`.
   - "Install" button validates required fields, runs
     interpolation, emits `add`. "Cancel" collapses the form.
   - Drafted values persisted in `localStorage` keyed by entry
     id so reopening the form pre-fills (so the user doesn't
     lose the api key on accidental cancel).
3. **Catalog entries** — add the 6 above with `configSchema`
   metadata pointing at i18n keys.
4. **i18n** — add display name / description / field labels /
   field help-text for all new entries × 8 locales (`en` / `ja`
   / `zh` / `ko` / `es` / `pt-BR` / `fr` / `de`). Strict
   lockstep — `vue-tsc` will fail otherwise.
5. **Tests**:
   - Unit (`test/utils/mcp/test_interpolateSpec.ts`): happy path,
     missing required value, missing optional value (passes
     through), nested `args` / `env` / `headers`, escape
     handling.
   - E2E (`e2e/tests/mcp-catalog-config.spec.ts`): toggle Notion
     on → form shows → submit empty → required error → fill key
     → submit → server appears in custom list with the resolved
     env. Re-toggle off → entry removed.
6. Plan file moves to `plans/done/` after merge.

## Implementation notes for reviewers

- **Package names** — community packages can drift; the same
  `TODO(reviewer): pin maintained package` markers from Phase 1
  apply to Notion / Slack / Google Maps / Weather entries.
  Verify weekly downloads + last commit before merge.
- **`isMcpStdioSpec` allowlist** — stdio commands are restricted
  to `npx` / `node` / `tsx`. All new entries use `npx -y …`,
  matching Phase 1.
- **Security** — `secret`-kind fields render as `<input
  type="password">` and are stored in the spec's `env` like any
  other env var (`mcp.json` already has 0o600 perms via
  `writeFileAtomicSync`). localStorage drafts are NOT encrypted
  — that's a known limitation; users on a shared machine should
  prefer to leave the form blank until they're ready to install.
