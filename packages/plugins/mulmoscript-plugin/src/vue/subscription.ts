// One subscription shape from two call forms (#3015).
//
// `MulmoScriptTransport` is exported from `/vue` on a package already
// published to npm, so the two-argument calls that predate roots must keep
// working: a third positional parameter binds an existing caller's `handler`
// to `root`, and the event path then calls a handler as `root()` (Codex +
// CodeRabbit on #3015). But an OPTIONAL root is the shape that shipped broken
// twice on the server side of this same PR — the pair filter compares
// `undefined` against every named root and silently drops the events it exists
// to route.
//
// An options object satisfies both, and the discrimination is total: the
// legacy form's first argument is a function, which an options object never
// is. It lives here, as a pure function, because it is the part with a wrong
// answer available — the pubsub wiring around it has none.
import type { MulmoScriptGenerationEvent } from "../core/contract";

export interface GenerationSubscription {
  filePath: () => string;
  root: () => string | undefined;
  handler: (event: MulmoScriptGenerationEvent) => void;
}

export interface ScriptChangedSubscription {
  filePath: () => string;
  root: () => string | undefined;
  /** This View's id — its own writes echo back and must not be acted on. */
  ownOrigin: string;
  handler: () => void;
}

/** A caller that predates roots is asking for the host's default root. */
const DEFAULT_ROOT_GETTER = (): string | undefined => undefined;

export function normalizeGenerationSubscription(
  first: GenerationSubscription | (() => string),
  legacyHandler?: (event: MulmoScriptGenerationEvent) => void,
): GenerationSubscription {
  if (typeof first !== "function") return first;
  if (!legacyHandler) throw new TypeError("onGenerationEvent(filePath, handler): handler is required");
  return { filePath: first, root: DEFAULT_ROOT_GETTER, handler: legacyHandler };
}

export function normalizeScriptChangedSubscription(
  first: ScriptChangedSubscription | (() => string),
  legacyOwnOrigin?: string,
  legacyHandler?: () => void,
): ScriptChangedSubscription {
  if (typeof first !== "function") return first;
  if (typeof legacyOwnOrigin !== "string" || !legacyHandler) {
    throw new TypeError("onScriptChanged(filePath, ownOrigin, handler): ownOrigin and handler are required");
  }
  return { filePath: first, root: DEFAULT_ROOT_GETTER, ownOrigin: legacyOwnOrigin, handler: legacyHandler };
}
