// Read an HTML artifact file under the `/artifacts/html` static
// mount and splice the image-self-repair script before its closing
// `</body>`. Re-wires the script that PR #980 unhooked when
// presentHtml / Files HTML preview moved off `srcdoc` onto the
// static mount (#1011 Stage E follow-up, #1025).
//
// Lives in its own module — not inline in `server/index.ts` — so a
// unit test can import the helper without dragging the entire
// server startup as an import side effect.

import { readFile as fsReadFile } from "fs/promises";
import { resolveWithinRoot } from "../files/safe.js";
import { injectImageRepairScript } from "../../../src/utils/image/imageRepairInlineScript.js";

/** Read an HTML artifact file (under `htmlsRoot`) and splice the
 *  image-self-repair script before its closing `</body>`. Returns
 *  the spliced HTML on success, `null` when the file can't be
 *  resolved (escapes the root) or read (missing / unreadable).
 *
 *  `htmlsRoot` MUST already be a realpath — `resolveWithinRoot`
 *  compares against it strictly. The middleware in `server/index.ts`
 *  passes the cached `getHtmlsDirReal()` result, which is a realpath. */
export async function readAndInjectHtmlArtifact(htmlsRoot: string, relPath: string): Promise<string | null> {
  const abs = resolveWithinRoot(htmlsRoot, relPath);
  if (!abs) return null;
  let raw: string;
  try {
    raw = await fsReadFile(abs, "utf8");
  } catch {
    return null;
  }
  return injectImageRepairScript(raw);
}
