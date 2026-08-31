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
import { normalizeGenerationSubscription, normalizeScriptChangedSubscription } from "./subscription";
import type { GenerationSubscription, ScriptChangedSubscription } from "./subscription";
export type { GenerationSubscription, ScriptChangedSubscription } from "./subscription";
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
/**
 * A field that is absent, or a string.
 *
 * `undefined` is a legitimate answer for both `root` and `origin`, so a
 * present-but-wrong-typed value CANNOT be flattened into it: `root: 42` read
 * as "no root" makes a named root's event look like a default-root one, and
 * the subscriber then routes another repository's script to this View
 * (CodeRabbit on #3015 — the same shape the dispatch boundary was just fixed
 * for). Malformed means malformed; the caller rejects the payload.
 */
function optionalString(value: unknown): { ok: true; value: string | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  return typeof value === "string" ? { ok: true, value } : { ok: false };
}

export function parseScriptChangedEvent(payload: unknown): MulmoScriptChangedEvent | null {
  if (!isRecord(payload)) return null;
  const { filePath, origin, root } = payload;
  if (typeof filePath !== "string") return null;
  // `origin` decides whether this View acts on the echo of its OWN write.
  // Read as absent, a malformed one makes every keystroke rebuild the element
  // the caret is in — so it is identity too, and rejected the same way.
  const parsedOrigin = optionalString(origin);
  const parsedRoot = optionalString(root);
  if (!parsedOrigin.ok || !parsedRoot.ok) return null;
  return {
    filePath,
    ...(parsedOrigin.value !== undefined ? { origin: parsedOrigin.value } : {}),
    ...(parsedRoot.value !== undefined ? { root: parsedRoot.value } : {}),
  };
}

export function parseGenerationEvent(payload: unknown): MulmoScriptGenerationEvent | null {
  if (!isRecord(payload)) return null;
  const { kind, filePath, key, done, error, root } = payload;
  if (typeof kind !== "string" || !GENERATION_EVENT_KINDS.has(kind)) return null;
  if (typeof filePath !== "string" || typeof key !== "string" || typeof done !== "boolean") return null;
  const parsedRoot = optionalString(root);
  if (!parsedRoot.ok) return null;
  return {
    kind: kind as MulmoScriptGenerationEvent["kind"],
    filePath,
    key,
    done,
    // `error` is the one field a malformed value may be dropped from rather
    // than rejected with: it is a message shown beside a finished generation,
    // and rejecting the whole event would drop the FINISH — leaving the
    // spinner running forever, which is worse than losing the text.
    ...(typeof error === "string" ? { error } : {}),
    ...(parsedRoot.value !== undefined ? { root: parsedRoot.value } : {}),
  };
}

export interface MulmoScriptTransport {
  call<K extends MulmoScriptDispatchArgs["kind"]>(kind: K, args: ArgsFor<K>): Promise<TransportResult<MulmoScriptDispatchResult[K]>>;
  /** Subscribe to the host's generation channel, pre-filtered to one script —
   *  identified by the PAIR `(root, filePath)`, since the same wire path
   *  exists in every registered root (#3014). Returns the unsubscribe
   *  function. */
  onGenerationEvent(subscription: GenerationSubscription): () => void;
  /** The pre-#3014 form: no root named, so the host's default root. Kept
   *  because this interface is exported from `/vue` on a published package. */
  onGenerationEvent(filePath: () => string, handler: (event: MulmoScriptGenerationEvent) => void): () => void;
  /** Subscribe to writes of one script, skipping the echo of this View's own
   *  (`ownOrigin`). Same pair identity as above. Returns the unsubscribe
   *  function. */
  onScriptChanged(subscription: ScriptChangedSubscription): () => void;
  /** The pre-#3014 form — see `onGenerationEvent` above. */
  onScriptChanged(filePath: () => string, ownOrigin: string, handler: () => void): () => void;
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

  function onGenerationEvent(first: GenerationSubscription | (() => string), legacyHandler?: (event: MulmoScriptGenerationEvent) => void): () => void {
    const { filePath, root, handler } = normalizeGenerationSubscription(first, legacyHandler);
    return runtime.pubsub.subscribe(GENERATION_EVENT, (payload: unknown) => {
      const event = parseGenerationEvent(payload);
      if (!event) return;
      const current = filePath();
      // The PAIR, not the path: `stories/deck.json` exists in every root, so
      // filtering on the path alone puts another repository's spinners on this
      // View (Codex P1 on #3015). `root` is a required FIELD rather than an
      // optional parameter because a forgotten optional is exactly how the
      // server side of this shipped broken twice — see `GenerationSubscription`.
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
  function onScriptChanged(first: ScriptChangedSubscription | (() => string), legacyOwnOrigin?: string, legacyHandler?: () => void): () => void {
    const { filePath, root, ownOrigin, handler } = normalizeScriptChangedSubscription(first, legacyOwnOrigin, legacyHandler);
    return runtime.pubsub.subscribe(SCRIPT_CHANGED_EVENT, (payload: unknown) => {
      const event = parseScriptChangedEvent(payload);
      if (!event) return;
      if (!shouldReloadForScriptChange(event, filePath(), ownOrigin, root())) return;
      handler();
    });
  }

  return { call, onGenerationEvent, onScriptChanged };
}
