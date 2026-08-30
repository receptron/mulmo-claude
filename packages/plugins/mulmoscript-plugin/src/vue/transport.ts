// Host-agnostic transport for the presentMulmoScript View. Every operation
// goes through `useRuntime().dispatch({ kind, … })` and returns the same
// `{ ok, data | error }` shape the pre-extraction `apiGet`/`apiPost`
// helpers produced, so the View's call sites stay structurally identical.
//
// Dispatch responses are `{ ok: … }` envelopes (see `core/contract.ts`):
// business failures arrive as `{ ok: false, error }` data rather than HTTP
// errors, keeping user-facing messages free of transport prefixes. A thrown
// dispatch (network drop, host bug) is caught and folded into the same
// failure shape.

import { useRuntime } from "gui-chat-protocol/vue";
import type { MulmoScriptChangedEvent, MulmoScriptDispatchArgs, MulmoScriptDispatchResult, MulmoScriptGenerationEvent } from "../core/contract";
import { GENERATION_EVENT, SCRIPT_CHANGED_EVENT, sameRoot, shouldReloadForScriptChange } from "../core/contract";
import { errorMessage } from "@mulmoclaude/common";
import { isRecord } from "./support";

export type TransportResult<T> = { ok: true; data: T } | { ok: false; error: string };

type ArgsFor<K extends MulmoScriptDispatchArgs["kind"]> = Omit<Extract<MulmoScriptDispatchArgs, { kind: K }>, "kind">;

const GENERATION_EVENT_KINDS: ReadonlySet<string> = new Set(["beatImage", "beatAudio", "characterImage", "movie", "pdf"]);

// These parsers are the boundary the pair identity has to survive. Rebuilding
// the event field by field means a field nobody listed is silently dropped —
// which is how `(root, filePath)` checks were added downstream and compared
// `undefined` against every named root, filtering out the very events they
// were written to route (Codex P1 on #3015).
export function parseScriptChangedEvent(payload: unknown): MulmoScriptChangedEvent | null {
  if (!isRecord(payload)) return null;
  const { filePath, origin, root } = payload;
  if (typeof filePath !== "string") return null;
  return {
    filePath,
    ...(typeof origin === "string" ? { origin } : {}),
    ...(typeof root === "string" ? { root } : {}),
  };
}

export function parseGenerationEvent(payload: unknown): MulmoScriptGenerationEvent | null {
  if (!isRecord(payload)) return null;
  const { kind, filePath, key, done, error, root } = payload;
  if (typeof kind !== "string" || !GENERATION_EVENT_KINDS.has(kind)) return null;
  if (typeof filePath !== "string" || typeof key !== "string" || typeof done !== "boolean") return null;
  return {
    kind: kind as MulmoScriptGenerationEvent["kind"],
    filePath,
    key,
    done,
    ...(typeof error === "string" ? { error } : {}),
    ...(typeof root === "string" ? { root } : {}),
  };
}

export interface MulmoScriptTransport {
  call<K extends MulmoScriptDispatchArgs["kind"]>(kind: K, args: ArgsFor<K>): Promise<TransportResult<MulmoScriptDispatchResult[K]>>;
  /** Subscribe to the host's generation channel, pre-filtered to one script —
   *  identified by the PAIR `(root, filePath)`, since the same wire path
   *  exists in every registered root (#3014). Returns the unsubscribe
   *  function. */
  onGenerationEvent(filePath: () => string, root: () => string | undefined, handler: (event: MulmoScriptGenerationEvent) => void): () => void;
  /** Subscribe to writes of one script, skipping the echo of this View's own
   *  (`ownOrigin`). Same pair identity as above. Returns the unsubscribe
   *  function. */
  onScriptChanged(filePath: () => string, root: () => string | undefined, ownOrigin: string, handler: () => void): () => void;
}

export function useMulmoScriptTransport(): MulmoScriptTransport {
  const runtime = useRuntime();

  async function call<K extends MulmoScriptDispatchArgs["kind"]>(kind: K, args: ArgsFor<K>): Promise<TransportResult<MulmoScriptDispatchResult[K]>> {
    let result: unknown;
    try {
      result = await runtime.dispatch({ kind, ...args });
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
    if (!isRecord(result) || result.ok !== true) {
      const error = isRecord(result) && typeof result.error === "string" ? result.error : `dispatch ${kind} returned an unexpected response`;
      return { ok: false, error };
    }
    return { ok: true, data: result as MulmoScriptDispatchResult[K] };
  }

  function onGenerationEvent(filePath: () => string, root: () => string | undefined, handler: (event: MulmoScriptGenerationEvent) => void): () => void {
    return runtime.pubsub.subscribe(GENERATION_EVENT, (payload: unknown) => {
      const event = parseGenerationEvent(payload);
      if (!event) return;
      const current = filePath();
      // The PAIR, not the path: `stories/deck.json` exists in every root, so
      // filtering on the path alone puts another repository's spinners on this
      // View (Codex P1 on #3015). `root` is a required parameter rather than an
      // optional one because a forgotten optional is exactly how the server
      // side of this shipped broken twice.
      if (!current || event.filePath !== current || !sameRoot(event.root, root())) return;
      handler(event);
    });
  }

  /**
   * A write to this script landed — reload from disk.
   *
   * `ownOrigin` is this View's id. Its own writes echo back on the same channel, and acting
   * on them would rebuild the element the caret is in on every keystroke, so they are dropped
   * here. A write from the agent carries no origin and always reaches the handler.
   */
  function onScriptChanged(filePath: () => string, root: () => string | undefined, ownOrigin: string, handler: () => void): () => void {
    return runtime.pubsub.subscribe(SCRIPT_CHANGED_EVENT, (payload: unknown) => {
      const event = parseScriptChangedEvent(payload);
      if (!event) return;
      if (!shouldReloadForScriptChange(event, filePath(), ownOrigin, root())) return;
      handler();
    });
  }

  return { call, onGenerationEvent, onScriptChanged };
}
