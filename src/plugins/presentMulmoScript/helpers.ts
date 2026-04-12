// Pure helpers for presentMulmoScript View.vue. Kept separate so
// their logic is unit-testable without mounting the Vue component.

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
  if (typeof obj !== "object" || obj === null) return null;
  const event = obj as Record<string, unknown>;
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
export function shouldAutoRenderBeat(
  beat: { image?: { type?: string } | undefined },
  hasCharacters: boolean,
  autoRenderTypes: readonly string[],
): boolean {
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
export function getMissingCharacterKeys(
  keys: readonly string[],
  images: Record<string, unknown>,
  renderState: Record<string, string | undefined>,
): string[] {
  return keys.filter((k) => !images[k] && renderState[k] !== "rendering");
}

/**
 * A schema shape that exposes `safeParse` — matches Zod's API
 * without pulling the dep into this module.
 */
export interface SafeParseSchema {
  safeParse(value: unknown): { success: boolean };
}

/**
 * Validate a candidate Beat JSON string against a schema.
 * Returns false on any JSON parse error or schema mismatch.
 */
export function validateBeatJSON(
  json: string,
  schema: SafeParseSchema,
): boolean {
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
  return err instanceof Error ? err.message : String(err);
}
