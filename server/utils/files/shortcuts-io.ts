// Domain IO for `config/shortcuts.json` — the manually-pinned launcher
// shortcuts (collections / feeds). Follows the `*-io.ts` pattern: all
// writes go through `writeFileAtomic`; a missing file reads as `[]`.

import path from "node:path";
import { WORKSPACE_FILES, workspacePath } from "../../workspace/paths.js";
import { writeFileAtomic } from "./atomic.js";
import { readTextSafe } from "./safe.js";
import { isRecord } from "../types.js";
import { SHORTCUT_KINDS, sameShortcut, unknownShortcutFields, type Shortcut, type ShortcutsFile } from "../../../src/types/shortcuts.js";
import { isAccentColor } from "@mulmoclaude/core/collection";

function shortcutsFilePath(workspaceRoot?: string): string {
  return path.join(workspaceRoot ?? workspacePath, WORKSPACE_FILES.shortcuts);
}

/** One raw JSON value as a `Shortcut`, or null when it cannot be one.
 *
 *  Split out of the loop below so each concern stays readable on its own: this
 *  answers "what IS a shortcut entry", the caller answers "which of them do we
 *  keep".
 *
 *  KEYS THIS BUILD DOES NOT KNOW ARE KEPT (#3055). The file is shared with
 *  MulmoTerminal and both apps rebuild every record they write — pin, unpin,
 *  reorder and reconcile all pass through here — so a field only one of them
 *  names is deleted by the other. `color` was exactly that, in both directions
 *  (#2987 / mulmoterminal#1993); MulmoTerminal carries the rest through since
 *  its #1996, and this is the symmetric half.
 *
 *  Carried, NOT merged: what goes back is what came in, so a field the OTHER app
 *  has just removed stays removed rather than being resurrected here.
 *
 *  The known fields are applied LAST, so a validated value always beats whatever
 *  the file held. */
function toShortcut(raw: unknown): Shortcut | null {
  if (!isRecord(raw)) return null;
  const { slug, title, icon, color } = raw;
  // `find` over the literal list narrows to `ShortcutKind` by construction —
  // a membership predicate would only assert it.
  const kind = SHORTCUT_KINDS.find((candidate) => candidate === raw.kind);
  if (kind === undefined) return null;
  if (typeof slug !== "string" || slug.length === 0) return null;
  return {
    ...unknownShortcutFields(raw),
    kind,
    slug,
    title: typeof title === "string" ? title : slug,
    icon: typeof icon === "string" && icon.length > 0 ? icon : "bookmark",
    // Only a colour the palette carries is kept, so the file cannot accumulate
    // names nothing can draw. Added conditionally rather than assigned:
    // `color: undefined` would serialise as a null.
    ...(isAccentColor(color) ? { color } : {}),
  };
}

/** Coerce arbitrary JSON into a clean `Shortcut[]`: drop malformed entries
 *  (bad kind / empty slug / non-string fields) and dedupe on `(kind, slug)`
 *  keeping the first occurrence. Exported for the route validator and unit
 *  tests — pure, no IO. */
export function normalizeShortcuts(input: unknown): Shortcut[] {
  if (!Array.isArray(input)) return [];
  const out: Shortcut[] = [];
  for (const raw of input) {
    const entry = toShortcut(raw);
    if (entry === null) continue;
    if (out.some((existing) => sameShortcut(existing, entry))) continue;
    out.push(entry);
  }
  return out;
}

/** Read the pinned shortcuts. Missing / unreadable / malformed file
 *  → `[]` (never throws on absent state). */
export async function readShortcuts(workspaceRoot?: string): Promise<Shortcut[]> {
  const text = await readTextSafe(shortcutsFilePath(workspaceRoot));
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return normalizeShortcuts(isRecord(parsed) ? parsed.shortcuts : undefined);
  } catch {
    return [];
  }
}

/** Replace the full shortcut list. Normalises (validate + dedupe)
 *  before writing so the on-disk file is always clean. Returns the
 *  written list so callers can echo the canonical result. */
export async function writeShortcuts(shortcuts: unknown, workspaceRoot?: string): Promise<Shortcut[]> {
  const clean = normalizeShortcuts(shortcuts);
  const payload: ShortcutsFile = { shortcuts: clean };
  await writeFileAtomic(shortcutsFilePath(workspaceRoot), `${JSON.stringify(payload, null, 2)}\n`);
  return clean;
}
