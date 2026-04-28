// Pure helpers for presentMulmoScript View.vue. Kept separate so
// their logic is unit-testable without mounting the Vue component.

import { errorMessage } from "../../utils/errors";
import { isRecord } from "../../utils/types";

export type SSEEvent =
  | { type: "beat_image_done"; beatIndex: number }
  | { type: "beat_audio_done"; beatIndex: number }
  | { type: "done"; moviePath: string }
  | { type: "error"; message: string }
  | { type: "unknown" };

/**
 * Parse a single SSE line of the form `data: {json}`. Returns
 * null for non-data lines (comments, blank) or lines whose JSON
 * payload fails to parse. Unrecognised event types still parse
 * but resolve to `{ type: "unknown" }` so the caller can ignore
 * them without crashing.
 */
export function parseSSEEventLine(line: string): SSEEvent | null {
  if (!line.startsWith("data: ")) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(line.slice(6));
  } catch {
    return null;
  }
  if (!isRecord(obj)) return null;
  const event = obj;
  if (event.type === "beat_image_done" && typeof event.beatIndex === "number") {
    return { type: "beat_image_done", beatIndex: event.beatIndex };
  }
  if (event.type === "beat_audio_done" && typeof event.beatIndex === "number") {
    return { type: "beat_audio_done", beatIndex: event.beatIndex };
  }
  if (event.type === "done" && typeof event.moviePath === "string") {
    return { type: "done", moviePath: event.moviePath };
  }
  if (event.type === "error" && typeof event.message === "string") {
    return { type: "error", message: event.message };
  }
  return { type: "unknown" };
}

/**
 * Decide whether a beat should be rendered automatically at
 * script load time. Text-based beats (slides, charts, etc.) are
 * auto-rendered only when the script has no characters —
 * characters must be rendered first so they can be referenced by
 * any character-using beat.
 */
export function shouldAutoRenderBeat(beat: { image?: { type?: string } | undefined }, hasCharacters: boolean, autoRenderTypes: readonly string[]): boolean {
  if (hasCharacters) return false;
  const type = beat.image?.type;
  if (typeof type !== "string") return false;
  return autoRenderTypes.includes(type);
}

/**
 * Of the given character keys, return those whose image is not
 * yet loaded and is not currently rendering. Used to fetch only
 * what's missing after a movie-generation event arrives.
 */
export function getMissingCharacterKeys(keys: readonly string[], images: Record<string, unknown>, renderState: Record<string, string | undefined>): string[] {
  return keys.filter((charKey) => !images[charKey] && renderState[charKey] !== "rendering");
}

/**
 * A schema shape that exposes `safeParse` — matches Zod's API
 * without pulling the dep into this module.
 */
export interface SafeParseSchema {
  safeParse: (value: unknown) => { success: boolean };
}

/**
 * Validate a candidate Beat JSON string against a schema.
 * Returns false on any JSON parse error or schema mismatch.
 */
export function validateBeatJSON(json: string, schema: SafeParseSchema): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  return schema.safeParse(parsed).success;
}

/** Convert an unknown thrown value into a human-readable string. */
export function extractErrorMessage(err: unknown): string {
  return errorMessage(err);
}

/**
 * Callback set for `applyMovieEvent` / `streamMovieEvents`. Each
 * handler is scoped to one event shape; the dispatcher routes to
 * the right one based on the discriminated union's `type` field.
 * Keeping this as named handlers (rather than one big switch in
 * the caller) lets `generateMovie` stay under the
 * sonarjs/cognitive-complexity threshold.
 */
export interface MovieEventHandlers {
  onBeatImageDone: (beatIndex: number) => void;
  onBeatAudioDone: (beatIndex: number) => void;
  onDone: (moviePath: string) => void;
}

/**
 * Dispatch a single already-parsed SSE event from the movie
 * generation stream to the matching handler. `"error"` events
 * throw so the caller's try/catch can surface the message the
 * same way a network failure would. `"unknown"` events are
 * silently ignored — the server occasionally introduces new
 * event types before the client catches up, and we don't want
 * those to tear down an otherwise-healthy stream.
 */
export function applyMovieEvent(event: SSEEvent, handlers: MovieEventHandlers): void {
  switch (event.type) {
    case "beat_image_done":
      handlers.onBeatImageDone(event.beatIndex);
      return;
    case "beat_audio_done":
      handlers.onBeatAudioDone(event.beatIndex);
      return;
    case "done":
      handlers.onDone(event.moviePath);
      return;
    case "error":
      throw new Error(event.message);
    case "unknown":
  }
}

/**
 * Read the SSE stream body from the movie-generation endpoint
 * and dispatch every parsed event into the given handlers.
 * Returns when the server closes the stream; throws through any
 * `"error"` event or unhandled read error. Kept here (rather
 * than inline in `generateMovie`) so the reader + decoder +
 * line-buffer state machine is a single named unit instead of a
 * pyramid of `while` / `for` / `if` inside a Vue component.
 */
export async function streamMovieEvents(body: ReadableStream<Uint8Array>, handlers: MovieEventHandlers): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseSSEEventLine(line);
      if (!event) continue;
      applyMovieEvent(event, handlers);
    }
  }
}
