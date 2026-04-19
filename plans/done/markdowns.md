# Plan: File-Based Markdown & Image Storage for presentDocument

## Problem

The `presentDocument` plugin stores the full markdown (including base64-embedded images) inline in the ToolResult, which lives in the chat JSONL file. A document with 3-4 images can be 10+ MB of base64 text.

## Goal

1. Store generated markdown files in `{workspace}/markdowns/{uuid}.md`
2. Store generated images in `{workspace}/images/{uuid}.png` (reusing the image-store infrastructure)
3. Replace inline base64 image URLs in markdown with workspace-relative paths
4. When the user edits markdown in the View, update the file on disk
5. The ToolResult `data.markdown` field changes from inline content to a file path reference

## Design

### Storage layout

```
~/mulmoclaude/
  markdowns/
    a1b2c3d4.md          ← full markdown with image references
  images/
    e5f6g7h8.png         ← generated images (already exists from image plan)
```

### Markdown file content

The markdown file on disk contains image references as relative paths:

```markdown
# My Guide

![A scenic mountain](../images/e5f6g7h8.png)

Some text here...
```

### ToolResult data change

```
Before: { markdown: "# Title\n![prompt](data:image/png;base64,...)\n..." }
After:  { markdown: "markdowns/a1b2c3d4.md" }
```

The frontend detects whether `data.markdown` is a file path or inline content for backward compatibility.

## Implementation Steps

### Step 1: Add `markdowns/` to workspace

**File: `server/workspace/workspace.ts`**

Add `"markdowns"` to the `SUBDIRS` array.

### Step 2: Create markdown storage utility

**New file: `server/utils/markdown-store.ts`**

```typescript
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { workspacePath } from "../workspace.js";

const MARKDOWNS_DIR = path.join(workspacePath, "markdowns");

export async function saveMarkdown(content: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const filename = `${id}.md`;
  await fs.writeFile(path.join(MARKDOWNS_DIR, filename), content, "utf-8");
  return `markdowns/${filename}`;
}

export async function loadMarkdown(relativePath: string): Promise<string> {
  const absPath = path.join(workspacePath, relativePath);
  return fs.readFile(absPath, "utf-8");
}

export async function overwriteMarkdown(relativePath: string, content: string): Promise<void> {
  const absPath = path.join(workspacePath, relativePath);
  await fs.writeFile(absPath, content, "utf-8");
}

export function isMarkdownPath(value: string): boolean {
  return value.startsWith("markdowns/") && value.endsWith(".md");
}
```

### Step 3: Update `fillImagePlaceholders` to save images as files

**File: `server/api/routes/plugins.ts`**

Change `generateInlineImage()` to save the PNG to disk via `saveImage()` and return a workspace-relative path instead of a data URI. The markdown will contain `![prompt](images/abc123.png)` instead of base64.

### Step 4: Update `/api/present-document` to save markdown to disk

**File: `server/api/routes/plugins.ts`**

After filling image placeholders, save the filled markdown to disk via `saveMarkdown()`. Return the path in `data.markdown` instead of the full content.

### Step 5: Add markdown update endpoint

**File: `server/api/routes/plugins.ts`** (or new route)

```
PUT /api/markdowns/:filename
Body: { markdown: "..." }
```

Called when user edits markdown in the View — overwrites the file on disk.

### Step 6: Update frontend View.vue

**File: `src/plugins/markdown/View.vue`**

- On mount / selectedResult change: if `data.markdown` is a path, fetch the content via `GET /api/files/content?path=...`
- Render the fetched markdown content
- Images in the markdown use relative paths like `images/abc123.png` — these need to be resolved to `/api/files/raw?path=images/abc123.png` before rendering
- **Edit + Apply**: PUT the updated markdown to `/api/markdowns/:filename`, then re-fetch to confirm
- **Download**: fetch content first if it's a path, then download

### Step 7: Update frontend Preview.vue

**File: `src/plugins/markdown/Preview.vue`**

The preview shows the title, which comes from the ToolResult `title` field (not from the markdown content), so no change needed unless the preview shows a markdown snippet.

### Step 8: Resolve image paths in rendered markdown

When rendering markdown with `marked()`, image src attributes will be relative paths like `images/abc123.png`. Add a custom `marked` renderer or post-process the HTML to rewrite image `src` attributes to `/api/files/raw?path=images/abc123.png`.

## Backward Compatibility

- If `data.markdown` starts with `markdowns/`, treat as file path — fetch from server
- Otherwise treat as inline content (legacy sessions)
- Images: `marked` renderer handles both `data:` URIs and relative paths

## File Changes Summary

| File | Action |
|---|---|
| `server/workspace/workspace.ts` | Add `"markdowns"` to SUBDIRS |
| `server/utils/markdown-store.ts` | **New** — save/load/overwrite markdown files |
| `server/api/routes/plugins.ts` | Save images as files, save markdown as file, add PUT endpoint |
| `src/plugins/markdown/View.vue` | Fetch markdown from server, resolve image paths, save edits to server |
| `src/plugins/markdown/Preview.vue` | Possibly no change |
