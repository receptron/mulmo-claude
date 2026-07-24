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
import type { MulmoScriptDispatchArgs, MulmoScriptDispatchResult, MulmoScriptGenerationEvent } from "../core/contract";
import { GENERATION_EVENT } from "../core/contract";
import { errorMessage } from "@mulmoclaude/common";
import { isRecord } from "./support";

export type TransportResult<T> = { ok: true; data: T } | { ok: false; error: string };

type ArgsFor<K extends MulmoScriptDispatchArgs["kind"]> = Omit<Extract<MulmoScriptDispatchArgs, { kind: K }>, "kind">;

const GENERATION_EVENT_KINDS: ReadonlySet<string> = new Set(["beatImage", "beatAudio", "characterImage", "movie", "pdf"]);

function parseGenerationEvent(payload: unknown): MulmoScriptGenerationEvent | null {
  if (!isRecord(payload)) return null;
  const { kind, filePath, key, done, error } = payload;
  if (typeof kind !== "string" || !GENERATION_EVENT_KINDS.has(kind)) return null;
  if (typeof filePath !== "string" || typeof key !== "string" || typeof done !== "boolean") return null;
  return {
    kind: kind as MulmoScriptGenerationEvent["kind"],
    filePath,
    key,
    done,
    ...(typeof error === "string" ? { error } : {}),
  };
}

export interface MulmoScriptTransport {
  call<K extends MulmoScriptDispatchArgs["kind"]>(kind: K, args: ArgsFor<K>): Promise<TransportResult<MulmoScriptDispatchResult[K]>>;
  /** Subscribe to the host's generation channel, pre-filtered to one
   *  script's wire path. Returns the unsubscribe function. */
  onGenerationEvent(filePath: () => string, handler: (event: MulmoScriptGenerationEvent) => void): () => void;
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

  function onGenerationEvent(filePath: () => string, handler: (event: MulmoScriptGenerationEvent) => void): () => void {
    return runtime.pubsub.subscribe(GENERATION_EVENT, (payload: unknown) => {
      const event = parseGenerationEvent(payload);
      if (!event) return;
      const current = filePath();
      if (!current || event.filePath !== current) return;
      handler(event);
    });
  }

  return { call, onGenerationEvent };
}
