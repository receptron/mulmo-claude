// Contracts for the server-side ops entry (`./server`). Everything the ops
// need from a host that ISN'T generic mulmocast work is declared here as an
// injected backend — MulmoClaude and MulmoTerminal each supply their own
// implementation (phase 3 of plans/done/feat-mulmoscript-plugin.md).

import type { MinimalLogger } from "@mulmoclaude/common";
import type { FileOps } from "gui-chat-protocol";
import type { MulmoScriptChangedEvent, MulmoScriptGenerationEvent } from "../core/contract";

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
  beatIndex?: number | undefined;
  key?: string | undefined;
  force?: boolean | undefined;
  chatSessionId?: string | undefined;
}

/** `GenerateOpArgs` with `K` promoted to genuinely required. `Required<Pick<…>>`
 *  does NOT work here: under `exactOptionalPropertyTypes` the `-?` modifier drops
 *  only the `?`, leaving the explicitly declared `| undefined` in place, so the
 *  op body still sees `T | undefined`. `Omit` for the rest, because intersecting
 *  the whole interface would re-introduce the optional declaration. */
export type GenerateOpArgsWith<K extends keyof GenerateOpArgs> = { [P in K]-?: Exclude<GenerateOpArgs[P], undefined> } & Omit<GenerateOpArgs, K>;

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
  /** Absolute path of the DEFAULT stories directory
   *  (`<workspace>/artifacts/stories`). May not exist yet — the ops lazily
   *  create + realpath it. A wire path with no `root` resolves here, which
   *  is what makes every pre-`root` caller keep its exact behaviour. */
  storiesDir: string;
  /**
   * Additional stories roots, keyed by the id the wire `root` names
   * (#3014). Absent or empty = the single-root world this package shipped
   * with, byte for byte.
   *
   * The KEY IS OPAQUE TO THIS PACKAGE. It is looked up here and never
   * parsed, so the host owns what a root id means — a declared name, a
   * hash of the directory, an assigned handle. That decision is persisted
   * in the host's cards, so it belongs to whoever has to keep it stable,
   * and pinning it here would freeze it for every host at once.
   *
   * Registration is the containment boundary. `filePath` is a field the
   * MODEL fills (`core/definition.ts`), so the agent must never be able to
   * name a root: it may only address what the host already registered. The
   * tool definition is unchanged for exactly this reason — a host adds a
   * root, an agent cannot.
   */
  extraRoots?: Record<string, string>;
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
  /**
   * A script was written. Every open View reloads from disk, which is what makes an agent's
   * edit appear without the user reopening the canvas.
   */
  onScriptChanged?: (event: MulmoScriptChangedEvent) => void;
  log?: MulmoScriptServerLog;
}
