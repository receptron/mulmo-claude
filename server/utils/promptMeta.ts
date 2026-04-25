// Fingerprint user-controlled prompt text for structured logs without
// leaking the prompt itself.
//
// Image / text prompts are user input and routinely include pasted
// URLs, emails, or even credentials. Persisting any prefix of the
// raw prompt into structured log files (which we keep on disk and
// rotate) is a PII / secret leak waiting to happen.
//
// The fingerprint pairs `length` with a 12-hex-char prefix of the
// SHA-256 hash. 48 bits of entropy is enough to correlate retries
// and duplicate-request bursts within a session — collision risk
// at session-scale request volumes is negligible — without exposing
// any content.
//
// Use this in every new log call that would otherwise want to print
// a `promptPreview`. Existing call sites should migrate over time.

import { createHash } from "node:crypto";

const PROMPT_SHA256_PREFIX_CHARS = 12;

export interface PromptMeta {
  length: number;
  sha256: string;
}

export function promptMeta(prompt: string): PromptMeta {
  return {
    length: prompt.length,
    sha256: createHash("sha256").update(prompt).digest("hex").slice(0, PROMPT_SHA256_PREFIX_CHARS),
  };
}
