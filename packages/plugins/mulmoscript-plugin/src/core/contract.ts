// Host-agnostic dispatch envelope for the presentMulmoScript View. The Vue
// View is decoupled from any one host's REST surface: it calls
// `useRuntime().dispatch({ kind, … })`, the host routes that to its
// mulmoScript dispatch handler, and every response is an `{ ok: … }`
// envelope so failures travel as data (no HTTP-status coupling, no
// "dispatch failed (500)" prefixes in user-facing errors).
//
// Long-running generation (movie / PDF) is a single long-held dispatch that
// resolves when the pipeline finishes; per-beat progress arrives on the
// plugin pubsub channel (`GENERATION_EVENT`) instead of an SSE stream, which
// also covers generations started elsewhere (background autoGenerateMovie,
// another tab, the agent).

/** One in-flight or per-beat generation notice, published on the plugin
 *  pubsub `generation` channel and returned by the `pendingGenerations`
 *  snapshot. Value strings mirror @mulmobridge/protocol's GENERATION_KINDS
 *  so MulmoClaude's host bridge maps 1:1 without a lookup table. */
export interface MulmoScriptGenerationEvent {
  kind: "beatImage" | "beatAudio" | "characterImage" | "movie" | "pdf";
  /** Wire `stories/…` path of the script the generation belongs to. */
  filePath: string;
  /** Which stories root `filePath` is relative to (#3014). Absent = the
   *  host's default root, which is every event this package emitted before
   *  roots existed. */
  root?: string;
  /** beatIndex (as string) for beat*, character key for characterImage, "" for movie/pdf. */
  key: string;
  /** false = started, true = finished (reload the asset off disk). */
  done: boolean;
  /** Only set on done=true when the work failed. */
  error?: string;
}

/** Plugin pubsub event name the host publishes generation events on
 *  (full channel: `plugin:<scope>:generation`). */
export const GENERATION_EVENT = "generation";

/** Plugin pubsub event name for "this script changed on disk"
 *  (full channel: `plugin:<scope>:scriptChanged`). */
export const SCRIPT_CHANGED_EVENT = "scriptChanged";

/**
 * A script was written — by the agent, or by another View.
 *
 * `origin` is who wrote it. A View passes its own id on every write and ignores the echo of
 * its own: without that, a keystroke would round-trip through the server and reload the very
 * element the caret is in. An agent write carries no origin, so every View reloads.
 */
export interface MulmoScriptChangedEvent {
  filePath: string;
  /** Which stories root `filePath` is relative to (#3014). Absent = default. */
  root?: string;
  origin?: string;
}

/**
 * Whether a View watching `watching` should reload because of `event`.
 *
 * A pure rule rather than a condition inside the subscriber, because the case that matters is
 * the one that is invisible when it is wrong: a View acting on the echo of its own write
 * rebuilds the element the caret is in, on every keystroke.
 */
export const shouldReloadForScriptChange = (event: MulmoScriptChangedEvent, watching: string, ownOrigin: string, watchingRoot?: string): boolean =>
  watching !== "" && event.filePath === watching && sameRoot(event.root, watchingRoot) && event.origin !== ownOrigin;

/**
 * Two roots are the same when they name the same one, with absent meaning the
 * host's default (#3014).
 *
 * The identity of a script is the PAIR, not the path: `stories/deck.json` in
 * two repositories is two files, and comparing paths alone would reload the
 * View watching one because the other was saved. Absent normalises to the
 * default so a pre-`root` event and a default-root watcher still match — that
 * equivalence is what keeps every existing card working untouched.
 */
const sameRoot = (a: string | undefined, b: string | undefined): boolean => (a ?? "") === (b ?? "");

interface BeatRef {
  filePath: string;
  beatIndex: number;
}

interface CharacterRef {
  filePath: string;
  key: string;
}

/** Session tag for hosts that surface per-session generation indicators
 *  (MulmoClaude's sidebar). Optional everywhere; hosts without sessions
 *  ignore it. */
interface SessionTag {
  chatSessionId?: string | undefined;
}

export type MulmoScriptDispatchArgs =
  | ({ kind: "save" } & { filePath?: string; script?: unknown; filename?: string })
  | { kind: "updateBeat"; filePath: string; beatIndex: number; beat: unknown; origin?: string }
  | { kind: "updateScript"; filePath: string; script: unknown; origin?: string }
  | ({ kind: "beatImage" } & BeatRef)
  | ({ kind: "beatAudio" } & BeatRef)
  | ({ kind: "beatMovie" } & BeatRef)
  | ({ kind: "renderBeat" } & BeatRef & SessionTag & { force?: boolean })
  | ({ kind: "generateBeatAudio" } & BeatRef & SessionTag & { force?: boolean })
  | ({ kind: "uploadBeatImage" } & BeatRef & { imageData: string })
  | ({ kind: "characterImage" } & CharacterRef)
  | ({ kind: "renderCharacter" } & CharacterRef & SessionTag & { force?: boolean })
  | ({ kind: "uploadCharacterImage" } & CharacterRef & { imageData: string })
  | ({ kind: "movieStatus" } & { filePath: string })
  | ({ kind: "pdfStatus" } & { filePath: string })
  | ({ kind: "generateMovie" } & { filePath: string } & SessionTag)
  | ({ kind: "generatePdf" } & { filePath: string } & SessionTag)
  | { kind: "pendingGenerations"; filePath: string };

export type MulmoScriptDispatchKind = MulmoScriptDispatchArgs["kind"];

/** Failure half of every dispatch response. `code` mirrors the phase-1
 *  outcome codes so a host can log/telemetry on it; the View only reads
 *  `error`. */
export interface DispatchFailure {
  ok: false;
  code?: "bad_request" | "not_found" | "server_error";
  error: string;
}

export type DispatchEnvelope<T> = ({ ok: true } & T) | DispatchFailure;

/** Maps a dispatch `kind` to its success payload so the View's transport
 *  can call `dispatch` without casts at every site. */
export interface MulmoScriptDispatchResult {
  save: { script: Record<string, unknown>; filePath: string; message: string };
  updateBeat: Record<string, never>;
  updateScript: Record<string, never>;
  beatImage: { image: string | null };
  beatAudio: { audio: string | null };
  beatMovie: { moviePath: string | null };
  renderBeat: { image: string };
  generateBeatAudio: { audio: string };
  uploadBeatImage: { image: string };
  characterImage: { image: string | null };
  renderCharacter: { image: string };
  uploadCharacterImage: { image: string };
  movieStatus: { moviePath: string | null };
  pdfStatus: { pdfPath: string | null };
  generateMovie: { moviePath: string };
  generatePdf: { pdfPath: string };
  pendingGenerations: { pending: MulmoScriptGenerationEvent[] };
}
