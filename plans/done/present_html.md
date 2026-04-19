# presentHtml Plugin — Plan

## Overview

A local plugin that takes raw HTML as input and renders it in the canvas view. Claude generates the HTML itself and calls `presentHtml` to display it — no external LLM call, no `GEMINI_API_KEY` required.

This plugin **replaces** `generateHtml` and `editHtml` (both `@gui-chat-plugin/*` package plugins). Those packages and all their wiring are removed as part of this work.

---

## Tool Definition

Tool name: `presentHtml`

Parameters:

| Parameter | Type   | Required | Description                          |
|-----------|--------|----------|--------------------------------------|
| `html`    | string | yes      | Complete, self-contained HTML string |
| `title`   | string | no       | Short label shown in the preview     |

---

## Data Model

```ts
interface PresentHtmlData {
  html: string;
  title?: string;
  filePath: string;  // relative path within workspace, e.g. "HTMLs/my-page-1234567890.html"
}
```

Result stored as a `ToolResult<PresentHtmlData>`.

---

## Files to Remove

### Package dependencies (`package.json` + `yarn`)
- `@gui-chat-plugin/generate-html`
- `@gui-chat-plugin/edit-html`

### Server
- `server/api/routes/html.ts` — entire file (contains both `/generate-html` and `/edit-html` routes)

---

## Wiring to Remove

| File | What to remove |
|---|---|
| `server/index.ts` | `import htmlRoutes` and `app.use("/api", htmlRoutes)` |
| `server/agent/mcp-server.ts` | `GenerateHtmlDef` and `EditHtmlDef` imports; their entries in `TOOL_ENDPOINTS` and `ALL_TOOLS` |
| `src/tools/index.ts` | `GenerateHtmlPlugin` and `EditHtmlPlugin` imports; `generateHtml` and `editHtml` entries in plugins map |
| `server/agent/index.ts` | `"generateHtml"` and `"editHtml"` from `MCP_PLUGINS` |
| `src/App.vue` | `"generateHtml"` and `"editHtml"` from `GEMINI_PLUGINS` set |

---

## Files to Create

| File | Purpose |
|---|---|
| `src/plugins/presentHtml/definition.ts` | `toolDefinition` only — no Vue imports |
| `src/plugins/presentHtml/index.ts` | `ToolPlugin`: imports definition + `execute()` + Vue components |
| `src/plugins/presentHtml/View.vue` | Canvas view: renders HTML in a sandboxed `<iframe>` |
| `src/plugins/presentHtml/Preview.vue` | Sidebar thumbnail: shows title or first line of HTML |
| `server/api/routes/presentHtml.ts` | `POST /api/present-html` — thin pass-through route |

## Wiring to Add

| File | Change |
|---|---|
| `server/index.ts` | Import and mount `presentHtmlRoutes` at `/api` |
| `server/agent/mcp-server.ts` | Import definition, add to `TOOL_ENDPOINTS` and `ALL_TOOLS` |
| `src/tools/index.ts` | Register `presentHtml` plugin |
| `src/config/roles.ts` | Add `"presentHtml"` to relevant roles |
| `server/agent/index.ts` | Add `"presentHtml"` to `MCP_PLUGINS` |

---

## Backend Logic (`server/api/routes/presentHtml.ts`)

```
POST /api/present-html
Body: { html: string, title?: string }
```

- Validate `html` is present, return 400 if missing
- `slugify(title)` → URL-safe slug (fallback: `"page"`)
- Save to `workspace/HTMLs/${slug}-${Date.now()}.html` (create `HTMLs/` dir if needed)
- Return:
  ```json
  {
    "message": "Saved HTML to HTMLs/${fname}",
    "instructions": "Acknowledge that the HTML page has been presented to the user.",
    "data": { "html": "<...>", "title": "...", "filePath": "HTMLs/${fname}" }
  }
  ```

No external API calls. No env var requirements.

`slugify` follows the same logic as `presentMulmoScript`: lowercase, replace non-alphanumeric runs with `-`, trim leading/trailing `-`, cap at 60 chars.

---

## View Component (`View.vue`)

Renders the HTML in a sandboxed `<iframe>` with `srcdoc`, filling the full canvas area.

Layout:
- Full-height `<iframe srcdoc="..." sandbox="allow-scripts allow-same-origin" />` filling the canvas
- Optional header bar showing `title` if provided

---

## Preview Component (`Preview.vue`)

- Shows `title` if present, otherwise `"HTML Page"`
- Small grey text: first 60 characters of the `html` string (tags stripped) as a hint

---

## Roles to Enable

Add `"presentHtml"` to:

- **General** — Claude can produce and present HTML directly in conversation
- **Office** — useful for presenting rich formatted output or dashboards

---

## Key Design Decisions

1. **No LLM on the server** — the route is a pure pass-through. Claude generates the HTML itself and sends it as a string argument. This avoids external API dependencies and keeps the full generation in Claude's context window where it can iterate.
2. **Self-contained local plugin** — `PresentHtmlData` is defined locally; we do not import from the removed `@gui-chat-plugin/generate-html` package.
3. **Replaces generate + edit pair** — rather than two tools (generate via Gemini, then edit via Gemini), a single `presentHtml` tool lets Claude handle both generation and iteration using its own coding ability.

---

## Out of Scope (v1)

- Syntax highlighting of the source HTML
- Export / download button
