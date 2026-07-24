// Exclusive-create write for dropped-file uploads (#2270).
//
// Route handlers don't call raw `fs` — this is the domain module for that
// write. It deliberately does NOT go through `writeFileAtomic`: that writes a
// temp file and renames over the destination, which would silently clobber an
// existing file. The upload route's non-clobbering rename loop is built on the
// `wx` flag failing with EEXIST instead.

import { mkdir, writeFile } from "fs/promises";
import path from "path";

/** Create `absPath` holding `bytes`, creating parents as needed. Throws with
 *  `code: "EEXIST"` when the file is already there — the caller's cue to try
 *  the next `name (n).ext` candidate. */
export async function writeNewFileExclusive(absPath: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, bytes, { flag: "wx" });
}
