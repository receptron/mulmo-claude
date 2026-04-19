# Plan: File-Based Spreadsheet Storage

## Problem

Spreadsheet data (the full `sheets` array with all cells, formulas, and formats) is stored inline in chat JSONL files. Large spreadsheets can be substantial JSON blobs, bloating session files and slowing session loading.

## Goal

Store spreadsheet data as JSON files in `{workspace}/spreadsheets/` and replace inline data with a file reference (e.g. `"spreadsheets/{uuid}.json"`). The frontend fetches the data on demand via the existing `/api/files/content` route.

## Design

### Data reference format

The `data.sheets` field in `SpreadsheetToolData` changes from an inline array to a workspace-relative path string:

```text
spreadsheets/{uuid}.json
```

The frontend detects whether `data.sheets` is a string (file path) or array (legacy inline) and handles both.

### Storage layout

```text
~/mulmoclaude/
  spreadsheets/
    a1b2c3d4e5f6g7h8.json
    ...
```

Each JSON file contains the sheets array directly:

```json
[
  { "name": "Sheet1", "data": [[{"v": "Product"}, {"v": "Sales"}], ...] }
]
```

### Affected flows

| Flow | Where data is created | Change |
|---|---|---|
| **presentSpreadsheet** | `server/api/routes/plugins.ts` `/present-spreadsheet` | Write JSON to disk, return path |
| **View.vue load** | `src/plugins/spreadsheet/View.vue` | Detect path → fetch file from server |
| **View.vue edit** | `src/plugins/spreadsheet/View.vue` `saveMiniEditor()` / `applyChanges()` | PUT updated sheets to `/api/spreadsheets/:filename` |

## Implementation Steps

### Step 1: Add `spreadsheets/` to workspace

**File: `server/workspace/workspace.ts`**

- Add `"spreadsheets"` to the `SUBDIRS` array so `initWorkspace()` creates it.

### Step 2: Create spreadsheet storage utility

**New file: `server/utils/spreadsheet-store.ts`**

Following the `markdown-store.ts` pattern:

```typescript
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { workspacePath } from "../workspace.js";

const SPREADSHEETS_DIR = path.join(workspacePath, "spreadsheets");

/** Save sheets array as a JSON file. Returns the workspace-relative path. */
export async function saveSpreadsheet(sheets: unknown[]): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const filename = `${id}.json`;
  await fs.writeFile(
    path.join(SPREADSHEETS_DIR, filename),
    JSON.stringify(sheets),
    "utf-8",
  );
  return `spreadsheets/${filename}`;
}

/** Read a spreadsheet file and return the parsed sheets array. */
export async function loadSpreadsheet(relativePath: string): Promise<unknown[]> {
  const absPath = path.join(workspacePath, relativePath);
  const raw = await fs.readFile(absPath, "utf-8");
  return JSON.parse(raw);
}

/** Overwrite an existing spreadsheet file. */
export async function overwriteSpreadsheet(
  relativePath: string,
  sheets: unknown[],
): Promise<void> {
  const absPath = path.join(workspacePath, relativePath);
  await fs.writeFile(absPath, JSON.stringify(sheets), "utf-8");
}

/** Check if a string is a spreadsheet file path (not inline data). */
export function isSpreadsheetPath(value: string): boolean {
  return value.startsWith("spreadsheets/") && value.endsWith(".json");
}
```

### Step 3: Update server route — save to disk

**File: `server/api/routes/plugins.ts`**

Change the `/present-spreadsheet` handler to:
1. Call `executeSpreadsheet(req.body)` as before (validates the data).
2. Call `saveSpreadsheet(result.data.sheets)` to write to disk.
3. Replace `result.data.sheets` with the returned file path before sending the response.

### Step 4: Add PUT endpoint for edits

**File: `server/api/routes/plugins.ts`**

Add `PUT /api/spreadsheets/:filename`:

```typescript
router.put("/spreadsheets/:filename", async (req, res) => {
  const relativePath = `spreadsheets/${req.params.filename}`;
  const { sheets } = req.body;
  if (!sheets) { res.status(400).json({ error: "sheets is required" }); return; }
  if (!isSpreadsheetPath(relativePath)) { res.status(400).json({ error: "invalid path" }); return; }
  await overwriteSpreadsheet(relativePath, sheets);
  res.json({ path: relativePath });
});
```

### Step 5: Update `SpreadsheetToolData` type

**File: `src/plugins/spreadsheet/definition.ts`**

Change `sheets` to accept both formats:

```typescript
export interface SpreadsheetToolData {
  sheets: SpreadsheetSheet[] | string;  // string = file path reference
}
```

### Step 6: Update View.vue — fetch + save

**File: `src/plugins/spreadsheet/View.vue`**

- Add a local `sheets` ref that holds the resolved sheet data.
- On mount and when `selectedResult.data.sheets` changes: if it's a string, fetch via `/api/files/content?path=...`; if it's an array, use directly.
- `saveMiniEditor()` and `applyChanges()`: when `data.sheets` is a file path, PUT the updated sheets to `/api/spreadsheets/:filename` to overwrite the file on disk.
- `editableData` and all rendering derives from the local `sheets` ref instead of `selectedResult.data.sheets` directly.

### Step 7: Update Preview.vue

**File: `src/plugins/spreadsheet/Preview.vue`**

When `data.sheets` is a string (file path), the preview cannot count sheets without fetching. Show a generic preview (just title, no sheet count) in that case.

## Backward Compatibility

- `View.vue` handles both inline arrays (old sessions) and file paths (new sessions).
- `Preview.vue` gracefully handles both formats.
- Old JSONL files remain valid and renderable without migration.
- The `executeSpreadsheet()` function itself is unchanged — only the route handler wraps the result.

## File Changes Summary

| File | Action |
|---|---|
| `server/workspace/workspace.ts` | Add `"spreadsheets"` to SUBDIRS |
| `server/utils/spreadsheet-store.ts` | **New** — save/load/overwrite/detect |
| `server/api/routes/plugins.ts` | Save to disk in `/present-spreadsheet`; add PUT endpoint |
| `src/plugins/spreadsheet/definition.ts` | Widen `sheets` type to `SpreadsheetSheet[] \| string` |
| `src/plugins/spreadsheet/View.vue` | Fetch from file on load, save edits via PUT |
| `src/plugins/spreadsheet/Preview.vue` | Handle string-type sheets gracefully |
