# Chart plugin (ECharts) — issue #202

## Scope (MVP)

Chart/graph plugin built on Apache ECharts. Data-first: the LLM produces
a JSON spec (one or more charts per document), the UI renders them, the
user can export each chart as PNG.

**In scope**

- New local plugin `src/plugins/chart/` (`definition.ts`, `index.ts`,
  `View.vue`, `Preview.vue`)
- New MCP tool `presentChart({ document, title? })`
- Workspace storage at `<workspace>/charts/<slug>-<timestamp>.chart.json`
- Client-side PNG export per chart via `echartInstance.getDataURL()`
- Roles: added to `general`, `office`, `guide`, `tutor`
- `yarn add echarts`
- Unit tests (server route: slug + write, validate payload)
- E2E test: render one `.chart.json` with 2 charts (line + bar),
  confirm both mount and `<canvas>` is non-empty
- README section describing the plugin + an example document

**Out of scope (deferred)**

- `source: "spreadsheets/foo.json#sheet"` pointer — follow-up issue,
  requires fetching another file at render time and mapping to
  ECharts `dataset`
- Server-side PNG render (headless chrome / echarts SSR) — future B/C
- Wiki backlink integration of chart images — future
- Chart editing in UI — LLM-driven only

## Document shape

```json
{
  "title": "Apple Stock Analysis",
  "charts": [
    {
      "title": "Price trend",
      "type": "line",
      "option": { /* full ECharts option object */ }
    },
    {
      "title": "Volume",
      "type": "bar",
      "option": { /* full ECharts option object */ }
    }
  ]
}
```

- `charts` is always an array, even for a single chart
- `option` is ECharts' native option object, passed as-is to
  `chart.setOption(option)`
- `type` is informational (used for the preview badge); the actual
  chart type is determined by `option.series[].type`

## MCP tool

- **Name:** `presentChart`
- **Description:** "Save and present one or more ECharts visualizations
  as a document. Use for line/bar/candlestick/scatter/pie/heatmap/
  sankey/graph. Pass the ECharts option object(s) directly — no data
  massaging needed."
- **Parameters:**
  - `document` (required): `{ title?: string, charts: Array<{ title?, type?, option }> }`
  - `title` (optional): short label for the preview sidebar (defaults
    to `document.title` or "Chart")

## Server route (`server/api/routes/chart.ts`)

- `POST /api/present-chart` — body is the tool args
  - Slugify the title, timestamp the filename
  - `mkdir -p <workspace>/charts`
  - Write the document JSON
  - Return `{ message, instructions, data: { document, title, filePath } }`

## Wiring (all the places)

1. `src/plugins/chart/definition.ts` — `TOOL_NAME`, `toolDefinition`
2. `src/plugins/chart/index.ts` — `ToolPlugin` export, POST to
   `/api/present-chart`
3. `src/plugins/chart/View.vue` — renders the array of charts, each
   with its own ECharts instance + a "Download PNG" button
4. `src/plugins/chart/Preview.vue` — small preview card
5. `src/tools/index.ts` — register
6. `src/config/roles.ts` — add to general / office / guide / tutor
7. `server/api/routes/chart.ts` — new route
8. `server/index.ts` — mount route
9. `server/agent/mcp-server.ts` — add to `TOOL_ENDPOINTS` + `ALL_TOOLS`
10. `server/agent/plugin-names.ts` — add to `TOOL_ENDPOINTS` + `PLUGIN_DEFS`
11. `server/agent/index.ts` — add to `MCP_PLUGINS`
12. `server/workspace/workspace.ts` — add `charts` to `SUBDIRS`

## Tests

- `test/routes/test_chartRoute.ts` — POST body validation, slug → file
  path, writes valid JSON, 400 on missing `document.charts`
- `e2e/tests/chart-plugin.spec.ts` — stub `/api/agent` to deliver a
  `tool_result` for `presentChart` with a two-chart document, assert
  two `<canvas>` nodes and that the PNG button exists

## README

New subsection under "Configuring Additional Tools" (or as its own
section next to Wiki) documenting:

- What the plugin does
- Example `.chart.json` (line + bar)
- That you can edit the file directly (mirrors the mcp.json story)
- PNG export via the button in the UI
