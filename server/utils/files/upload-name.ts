// Filename handling for dropped-file uploads (#2270). Pure so the
// containment / collision rules can be tested without touching disk.

import path from "path";

/** Upper bound on the auto-rename search. A directory that somehow holds
 *  every candidate stops the retry loop instead of spinning forever. */
export const MAX_RENAME_ATTEMPTS = 1000;

/** Longest filename we accept. Most filesystems cap a single segment at 255;
 *  stay under it so the ` (n)` suffix still fits. */
const MAX_FILENAME_LENGTH = 200;

/** Highest code point we treat as a control character. */
const LAST_CONTROL_CODE_POINT = 0x1f;

/** The last path segment, splitting on BOTH separators — `path.basename` only
 *  honours the host's, so a Windows-shaped name would survive intact on POSIX. */
function lastSegment(rawName: string): string {
  const parts = rawName.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

/** Windows silently drops trailing dots and spaces when creating a file, so
 *  `malware.exe.` lands on disk as `malware.exe` while `path.extname` reports
 *  `"."` — sailing straight past an extension blocklist. Normalise the name
 *  before any policy check reads it. */
function stripTrailingDotsAndSpaces(segment: string): string {
  // Walked rather than regexed: `/[. ]+$/` backtracks super-linearly on a name
  // that is all dots, which is exactly the input an attacker controls.
  let end = segment.length;
  while (end > 0) {
    const char = segment[end - 1];
    if (char !== "." && char !== " ") break;
    end -= 1;
  }
  return segment.slice(0, end);
}

function stripControls(segment: string): string {
  return [...segment].filter((char) => (char.codePointAt(0) ?? 0) > LAST_CONTROL_CODE_POINT).join("");
}

function truncateKeepingExtension(base: string): string {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  return `${stem.slice(0, MAX_FILENAME_LENGTH - ext.length)}${ext}`;
}

/** Reduce a client-supplied name to a single safe path segment, or null when
 *  nothing usable survives. Directory components are dropped rather than
 *  honoured: the target folder comes from the drop target, never the filename. */
export function sanitizeUploadFilename(rawName: string): string | null {
  const base = stripTrailingDotsAndSpaces(stripControls(lastSegment(rawName)).trim());
  if (base === "" || base === "." || base === "..") return null;
  return base.length > MAX_FILENAME_LENGTH ? truncateKeepingExtension(base) : base;
}

/** The nth collision candidate for a name: `foo.png` at 1 → `foo (1).png`.
 *  Extension-less and dotfile names keep their shape (`.env` → `.env (1)`). */
export function renamedCandidate(filename: string, attempt: number): string {
  const ext = path.extname(filename);
  const stem = ext === "" ? filename : filename.slice(0, filename.length - ext.length);
  return `${stem} (${attempt})${ext}`;
}
