// Custom Marp themes (#1649). One `.css` file per theme under
// `config/marp-themes/`; filename (sans `.css`) is the registered
// theme name and the slug used by a slide deck's frontmatter
// `theme: <name>`. Loaded into the shared Marp themeSet by both
// the client previewer (`MarpView.vue`) and the server PDF route
// (`renderMarpPdf` in `routes/pdf.ts`), so a theme that renders in
// the previewer renders identically in the export.

import path from "node:path";
import { WORKSPACE_DIRS, workspacePath } from "./paths.js";
import { readdirUnderSync, readTextUnderSync } from "../utils/files/workspace-io.js";
import { ensureThemeDirective, marpThemeNameFromFilename, sanitizeMarpThemeCss } from "@mulmoclaude/markdown-utils/markdown/marpTheme";
import { log } from "../system/logger/index.js";

export interface MarpTheme {
  /** Slug used in the deck's frontmatter `theme: <name>`. Derived
   *  from the filename — `corporate.css` → `corporate`. */
  readonly name: string;
  /** CSS source, post-`ensureThemeDirective`. Safe to hand straight
   *  to `marp.themeSet.add()`. */
  readonly css: string;
}

/** Read every `.css` file under `config/marp-themes/`, filter out
 *  ones that fail the sanitizer, and re-stamp the `@theme` directive
 *  so the registered name matches the filename slug. Returns an
 *  empty list when the directory doesn't exist (= user hasn't added
 *  themes) — callers fall back to Marp's built-in default theme.
 *
 *  Rejected themes are logged at WARN once per call so the user
 *  can spot why their theme isn't appearing. */
export function listMarpThemes(): MarpTheme[] {
  const entries = readdirUnderSync(workspacePath, WORKSPACE_DIRS.marpThemes);
  return entries.flatMap((fileName) => {
    const name = marpThemeNameFromFilename(fileName);
    if (!name) return [];
    const raw = readTextUnderSync(workspacePath, path.posix.join(WORKSPACE_DIRS.marpThemes, fileName));
    if (raw === null || raw.length === 0) return [];
    const sanitised = sanitizeMarpThemeCss(raw);
    if (!sanitised.ok) {
      log.warn("marp-themes", "skipped theme: sanitiser rejected", { file: fileName, reason: sanitised.reason });
      return [];
    }
    return [{ name, css: ensureThemeDirective(raw, name) }];
  });
}
