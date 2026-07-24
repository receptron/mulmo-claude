// Contracts for the server-side ops entry (`./server`). Everything the ops
// need from a host that ISN'T generic mulmocast work is declared here as an
// injected backend — MulmoClaude and MulmoTerminal each supply their own
// implementation (phase 3 of plans/done/feat-mulmoscript-plugin.md).

import type { MinimalLogger } from "@mulmoclaude/common";
import type { FileOps } from "gui-chat-protocol";
import type { MulmoScriptGenerationEvent } from "../core/contract";

export interface OpFailure {
  ok: false;
  /** REST adapter mapping: bad_request→400, not_found→404,
   *  unavailable→503, server_error→500. */
  code: "bad_request" | "not_found" | "server_error" | "unavailable";
  error: string;
}

export type OpResult<T> = ({ ok: true } & T) | OpFailure;

export interface GenerateOpArgs {
  filePath: string;
  beatIndex?: number;
  key?: string;
  force?: boolean;
  chatSessionId?: string;
}

export type MovieGenerationResult = { ok: true; outputPath: string } | { ok: false; error: string };
export type PdfGenerationResult = { ok: true; outputPath: string } | { ok: false; error: string };

export interface MovieProgressEvent {
  kind: "image" | "audio";
  beatIndex: number;
}

/** Host logger; every entry is already namespaced to mulmoScript by the package, so hosts just bind their own prefix/transport. */
export type MulmoScriptServerLog = MinimalLogger;

/**
 * Host capabilities the server ops run against. Only genuinely
 * host-specific transport lives here — the mulmocast orchestration, path
 * containment, and generation-state tracking are all in-package.
 */
export interface MulmoScriptServerBackend {
  /** Absolute path of the stories directory (`<workspace>/artifacts/stories`).
   *  May not exist yet — the ops lazily create + realpath it. */
  storiesDir: string;
  /** Shared artifacts FileOps (rooted at `<workspace>/artifacts`) for the
   *  save / reopen / update dispatch kinds (phase-1 core executes). */
  artifacts: FileOps;
  /** Atomic file write (tmp alongside destination + rename; parent dirs
   *  created). Hosts inject their hardened implementation. */
  writeFileAtomic: (absolutePath: string, data: string | Uint8Array) => Promise<void>;
  /** ffmpeg availability probe. `false` blocks render/movie/PDF ops with a
   *  clear message; `true`/`undefined` proceeds (a boot probe may not have
   *  completed yet — never block on the startup window). */
  isFfmpegAvailable?: () => boolean | undefined;
  /**
   * Generation fan-out (session channels, UI pubsub). Called on EDGE
   * transitions only — first start / last finish of concurrent same-key
   * runs — plus the finish-only per-beat pulses from the movie/PDF
   * pipelines. `chatSessionId` is undefined for callers outside a chat
   * session. The package keeps the in-flight snapshot itself.
   */
  onGenerationEvent?: (chatSessionId: string | undefined, event: MulmoScriptGenerationEvent) => void;
  log?: MulmoScriptServerLog;
}
