// The mulmoScript dispatch router, moved from MulmoClaude's
// `server/plugins/mulmoscript-builtin.ts` in phase 3 so every host serves
// the package View's `useRuntime().dispatch({ kind, … })` calls with the
// SAME kind routing and validation. Hosts register the returned handler on
// their dispatch channel (MulmoClaude: `registerBuiltinDispatch`;
// MulmoTerminal: its `/api/plugin` interception).
//
// Response contract: every kind resolves to an `{ ok: … }` envelope (see
// `../core/contract.ts`) — business failures are data, not thrown errors,
// so user-facing messages stay free of transport prefixes.

import { executeMulmoScriptSave, executeUpdateBeat, executeUpdateScript, type MulmoScriptFailure } from "../core/plugin";
import type { MulmoScriptExecuteContext } from "../core/types";
import type { MulmoScriptServerOps } from "./ops";
import type { OpFailure } from "./types";

interface DispatchFailure {
  ok: false;
  code: "bad_request" | "not_found" | "server_error";
  error: string;
}

function fromOpFailure(failure: OpFailure): DispatchFailure {
  // "unavailable" (ffmpeg missing) has no slot in the contract's code
  // union — the View only reads `error`, so fold it into server_error
  // rather than widening the shared contract for one case.
  const code = failure.code === "unavailable" ? "server_error" : failure.code;
  return { ok: false, code, error: failure.error };
}

function fromPackageFailure(failure: MulmoScriptFailure): DispatchFailure {
  return { ok: false, code: failure.code, error: failure.error };
}

function invalidArgs(kind: string): DispatchFailure {
  return { ok: false, code: "bad_request", error: `invalid arguments for mulmoScript dispatch kind "${kind}"` };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// Beat indexes must be non-negative integers — reject `-1` / `1.5` at the
// dispatch boundary so invalid client input surfaces as a deterministic
// bad_request instead of leaking into beat-indexed ops.
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

interface BeatArgs {
  filePath: string;
  beatIndex: number;
}

interface KeyArgs {
  filePath: string;
  key: string;
}

/** Pass ok results through untouched; normalize failures for the wire. */
function envelope<T>(result: ({ ok: true } & T) | OpFailure): ({ ok: true } & T) | DispatchFailure {
  return result.ok ? result : fromOpFailure(result);
}

function beatArgs(args: Record<string, unknown>): BeatArgs | null {
  const filePath = str(args.filePath);
  const beatIndex = num(args.beatIndex);
  if (!filePath || beatIndex === undefined) return null;
  return { filePath, beatIndex };
}

function keyArgs(args: Record<string, unknown>): KeyArgs | null {
  const filePath = str(args.filePath);
  const key = str(args.key);
  if (!filePath || !key) return null;
  return { filePath, key };
}

const PROBE_KINDS = new Set(["beatImage", "beatAudio", "beatMovie", "characterImage", "movieStatus", "pdfStatus"]);
const GENERATE_KINDS = new Set(["renderBeat", "generateBeatAudio", "renderCharacter", "generateMovie", "generatePdf"]);
const UPLOAD_KINDS = new Set(["uploadBeatImage", "uploadCharacterImage"]);

export type MulmoScriptDispatchHandler = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Build the kind router over an ops instance. The save / reopen / update
 * kinds run the phase-1 core executes against the backend's artifacts
 * FileOps, guarded by the instance's realpath containment
 * (`guardStoryWirePath`) — the core's own guard is lexical.
 */
export function createMulmoScriptDispatchHandler(ops: MulmoScriptServerOps): MulmoScriptDispatchHandler {
  const executeContext: MulmoScriptExecuteContext = { files: { artifacts: ops.backend.artifacts } };

  async function saveKind(args: Record<string, unknown>): Promise<unknown> {
    // Writes stay in the default root until step 2 gives the executors a
    // per-root FileOps — see `guardStoryWriteRoot` (#3015 review G1).
    const rootGuard = ops.guardStoryWriteRoot(str(args.root));
    if (rootGuard) return fromOpFailure(rootGuard);
    const guard = ops.guardStoryWirePath(args.filePath, str(args.root));
    if (guard) return fromOpFailure(guard);
    const outcome = await executeMulmoScriptSave(executeContext, {
      script: args.script,
      filename: str(args.filename),
      filePath: str(args.filePath),
    });
    if (!outcome.ok) return fromPackageFailure(outcome);
    return { ok: true, script: outcome.script, filePath: outcome.filePath, message: outcome.message };
  }

  async function updateKind(kind: "updateBeat" | "updateScript", args: Record<string, unknown>): Promise<unknown> {
    const rootGuard = ops.guardStoryWriteRoot(str(args.root));
    if (rootGuard) return fromOpFailure(rootGuard);
    const guard = ops.guardStoryWirePath(args.filePath, str(args.root));
    if (guard) return fromOpFailure(guard);
    const outcome = kind === "updateBeat" ? await executeUpdateBeat(executeContext, args) : await executeUpdateScript(executeContext, args);
    if (!outcome.ok) return fromPackageFailure(outcome);
    // After the write landed, never before: a View that reloads on a failed write would
    // discard the user's edit and show the old file back.
    ops.publishScriptChanged(str(args.filePath) ?? "", str(args.origin), str(args.root));
    return { ok: true };
  }

  const STATUS_OPS = { movieStatus: ops.movieStatusOp, pdfStatus: ops.pdfStatusOp } as const;
  const BEAT_PROBE_OPS = { beatImage: ops.beatImageOp, beatAudio: ops.beatAudioOp, beatMovie: ops.beatMovieOp } as const;

  async function probeKind(kind: string, args: Record<string, unknown>): Promise<unknown> {
    const statusOp = STATUS_OPS[kind as keyof typeof STATUS_OPS];
    if (statusOp) {
      const filePath = str(args.filePath);
      return filePath ? envelope(await statusOp(filePath, str(args.root))) : invalidArgs(kind);
    }
    if (kind === "characterImage") {
      const parsed = keyArgs(args);
      return parsed ? envelope(await ops.characterImageOp(parsed.filePath, parsed.key, str(args.root))) : invalidArgs(kind);
    }
    const parsed = beatArgs(args);
    if (!parsed) return invalidArgs(kind);
    return envelope(await BEAT_PROBE_OPS[kind as keyof typeof BEAT_PROBE_OPS](parsed.filePath, parsed.beatIndex, str(args.root)));
  }

  /** Movie and PDF take the whole script; the other generate kinds take a beat
   *  or a character within it. */
  async function wholeScriptGenerationKind(kind: "generateMovie" | "generatePdf", args: Record<string, unknown>): Promise<unknown> {
    const filePath = str(args.filePath);
    if (!filePath) return invalidArgs(kind);
    const chatSessionId = str(args.chatSessionId);
    const root = str(args.root);
    const result = kind === "generateMovie" ? await ops.generateMovieOp(filePath, chatSessionId, root) : await ops.generatePdfOp(filePath, chatSessionId, root);
    return envelope(result);
  }

  async function generateKind(kind: string, args: Record<string, unknown>): Promise<unknown> {
    if (kind === "generateMovie" || kind === "generatePdf") return wholeScriptGenerationKind(kind, args);
    const chatSessionId = str(args.chatSessionId);
    const root = str(args.root);
    const force = args.force === true;
    if (kind === "renderCharacter") {
      const parsed = keyArgs(args);
      return parsed ? envelope(await ops.renderCharacterOp({ ...parsed, force, chatSessionId, root })) : invalidArgs(kind);
    }
    const parsed = beatArgs(args);
    if (!parsed) return invalidArgs(kind);
    const result =
      kind === "renderBeat"
        ? await ops.renderBeatOp({ ...parsed, force, chatSessionId, root })
        : await ops.generateBeatAudioOp({ ...parsed, force, chatSessionId, root });
    return envelope(result);
  }

  async function uploadKind(kind: string, args: Record<string, unknown>): Promise<unknown> {
    const imageData = str(args.imageData);
    if (!imageData) return invalidArgs(kind);
    if (kind === "uploadCharacterImage") {
      const parsed = keyArgs(args);
      return parsed ? envelope(await ops.uploadCharacterImageOp(parsed.filePath, parsed.key, imageData, str(args.root))) : invalidArgs(kind);
    }
    const parsed = beatArgs(args);
    if (!parsed) return invalidArgs(kind);
    return envelope(await ops.uploadBeatImageOp(parsed.filePath, parsed.beatIndex, imageData, str(args.root)));
  }

  return async (args: Record<string, unknown>): Promise<unknown> => {
    const kind = str(args.kind);
    if (!kind) return invalidArgs("<missing>");
    if (kind === "save") return saveKind(args);
    if (kind === "updateBeat" || kind === "updateScript") return updateKind(kind, args);
    if (PROBE_KINDS.has(kind)) return probeKind(kind, args);
    if (GENERATE_KINDS.has(kind)) return generateKind(kind, args);
    if (UPLOAD_KINDS.has(kind)) return uploadKind(kind, args);
    if (kind === "pendingGenerations") {
      const filePath = str(args.filePath);
      if (!filePath) return invalidArgs(kind);
      const root = str(args.root);
      // An empty snapshot for an unknown root is indistinguishable from "no
      // work is running" — see `guardStoryRootRegistered`.
      const rootGuard = ops.guardStoryRootRegistered(root);
      if (rootGuard) return fromOpFailure(rootGuard);
      return { ok: true, pending: ops.pendingGenerations(filePath, root) };
    }
    return { ok: false, code: "bad_request", error: `unknown mulmoScript dispatch kind "${kind}"` };
  };
}
