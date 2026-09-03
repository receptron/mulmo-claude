import type { FileOps } from "gui-chat-protocol";
import type { MulmoScript } from "@mulmocast/types";

/** Tool-call arguments for presentMulmoScript. `script` (create new) and
 *  `filePath` (reopen existing) are mutually exclusive — provide exactly one.
 *  `filename` only applies to the create path; `autoGenerateMovie` is handled
 *  by hosts that have a movie backend (the package core ignores it). */
export interface SaveMulmoScriptArgs {
  script?: unknown;
  filename?: string | undefined;
  filePath?: string | undefined;
  autoGenerateMovie?: boolean | undefined;
  /** With `filePath`: replace just this beat instead of re-sending the whole script. */
  beatIndex?: number | undefined;
  /** The replacement beat. Only meaningful with `filePath` + `beatIndex`. */
  beat?: unknown;
}

/** Result payload that drives the View. `filePath` is the historical
 *  `stories/<name>.json` wire form every mulmoScript endpoint keys on. */
export interface MulmoScriptData {
  script: MulmoScript;
  filePath: string;
}

/** Host capabilities the phase-1 core needs, delivered through the GENERIC
 *  gui-chat-protocol runtime — `files.artifacts` (the shared, user-browsable
 *  output area rooted at `<workspace>/artifacts`) and the optional
 *  `files.byPath` for the absolute `filePath` form. Save / reopen / update
 *  logic lives entirely in this package; heavy render backends (mulmocast,
 *  ffmpeg) stay host-side until phase 3. */
export interface MulmoScriptExecuteContext {
  files: {
    /** Rooted at `<workspace>/artifacts` — where NEW scripts are written, and
     *  where every RELATIVE `filePath` resolves, exactly as before. */
    artifacts: FileOps;
    /** Reads / writes a script the caller named by ABSOLUTE path. Supplied by
     *  hosts that let presentMulmoScript open a deck outside
     *  `artifacts/stories/`; without it, `filePath` keeps its original
     *  stories-only meaning, so an older host degrades to the previous
     *  behaviour instead of mis-resolving. */
    byPath?: FileOps;
  };
}
