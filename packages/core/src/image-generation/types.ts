// Shared, provider-neutral types for the server-only image-generation
// engine. Both hosts (MulmoClaude, MulmoTerminal) build an
// `ImageGenConfig` from THEIR own env once and pass it explicitly —
// the engine reads no `process.env` of its own, which keeps this
// module trivially portable and unit-testable.

/** The result shape every provider narrows down to. */
export interface ImageGenResult {
  // Raw base64 payload (no `data:` prefix). Undefined if the provider
  // declined to return an image, e.g. because the prompt was filtered.
  imageData?: string;
  // Optional text returned alongside the image (or in lieu of it).
  // Used as a fallback message when imageData is empty.
  message?: string;
}

/** The image providers this engine can dispatch to. */
export type ImageProvider = "gemini" | "openai";

/** Logger shape the engine logs through — matches the host `Logger`
 *  (prefix, message, optional structured data). Defaults to a no-op so
 *  a host may omit it. Structurally identical to `CollectionLogger`. */
export interface ImageGenLogger {
  error: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  warn: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  info: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  debug: (prefix: string, message: string, data?: Record<string, unknown>) => void;
}

/** Everything a call site needs to reach a provider. Assembled by the
 *  host from its own env + logger; the engine never reads env itself. */
export interface ImageGenConfig {
  geminiApiKey?: string;
  openaiApiKey?: string;
  // Raw env value (e.g. MULMOCLAUDE_IMAGE_PROVIDER); the resolver
  // validates it — an unrecognised value falls back to availability.
  provider?: string;
  // OpenAI image model, defaults to "gpt-image-1" in the OpenAI client.
  openaiImageModel?: string;
  log?: ImageGenLogger;
}

/** No-op logger used when `config.log` is absent. */
export const NOOP_IMAGE_GEN_LOGGER: ImageGenLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

/** Resolve a config's logger, defaulting to the no-op. */
export function loggerFor(config: ImageGenConfig): ImageGenLogger {
  return config.log ?? NOOP_IMAGE_GEN_LOGGER;
}
