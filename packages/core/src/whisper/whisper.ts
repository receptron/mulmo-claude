// Public server-side façade: wires the model downloader, the warm sidecar, and
// ffmpeg conversion into one host-agnostic service. The host injects the models
// directory + a logger and gates capability itself (platform / binary presence);
// this package assumes the binaries exist when called.

import { mkdirSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NOOP_LOGGER, type WhisperLogger } from "./internal.ts";
import { convertToWav16k } from "./ffmpeg.ts";
import { createModelDownloader } from "./models.ts";
import { createSidecar } from "./sidecar.ts";
import { isModelReady, type ModelStatus, type WhisperModelName } from "./models.ts";

export interface WhisperOptions {
  /** Directory that holds the GGML model files (e.g. `{workspace}/models`). */
  modelsDir: string;
  logger?: WhisperLogger;
  /** Defaults to "whisper-server" / "ffmpeg" on PATH. */
  serverBinary?: string;
  ffmpegBinary?: string;
}

export interface TranscribeRequest {
  base64: string;
  mimeType: string;
  language: string;
  model: WhisperModelName;
}

export interface Whisper {
  isModelReady: (model: WhisperModelName) => boolean;
  getModelStatus: (model: WhisperModelName) => ModelStatus;
  /** Fire-and-forget friendly; never throws (errors land in the status). */
  ensureModelDownloaded: (model: WhisperModelName) => Promise<void>;
  warmup: (model: WhisperModelName) => Promise<void>;
  transcribe: (req: TranscribeRequest) => Promise<{ text: string }>;
  shutdown: () => void;
}

// whisper.cpp returns these sentinels for non-speech windows; treat them as
// empty so the UI shows "didn't catch that" rather than a literal marker.
const BLANK_MARKERS = new Set(["[blank_audio]", "[silence]", "(silence)", "[ inaudible ]"]);

// Whisper was trained on YouTube-style captions, so on near-silent / non-speech
// segments it hallucinates the boilerplate that ends such videos ("thanks for
// watching", "please subscribe", …). These arrive as real-looking text, so the
// BLANK_MARKERS set alone won't catch them. We drop a segment only when its
// ENTIRE content (after stripping punctuation and de-duplicating repeats) is one
// of these phrases — genuine speech that merely contains the phrase survives.
const HALLUCINATION_PHRASES = new Set([
  // Japanese (the ones the user actually hit come first)
  "ご視聴ありがとうございました",
  "ご視聴ありがとうございます",
  "ご視聴いただきありがとうございました",
  "ご視聴いただきありがとうございます",
  "最後までご視聴いただきありがとうございました",
  "最後までご視聴いただきありがとうございます",
  "ありがとうございました",
  "ありがとうございます",
  "またお会いしましょう",
  "また次回お会いしましょう",
  "次回もお楽しみに",
  "チャンネル登録をお願いします",
  "チャンネル登録よろしくお願いします",
  "おやすみなさい",
  // English equivalents whisper emits in the same situation
  "thank you",
  "thank you for watching",
  "thanks for watching",
  "please subscribe",
  "thank you very much",
  "you",
]);

// Punctuation + whitespace whisper may add around a hallucinated phrase. We
// strip ALL of it (including internal spaces) before matching so multi-word
// English phrases like "thank you for watching" compare cleanly against a
// space-free canonical form; Japanese phrases have no spaces so are unaffected.
const NOISE_CHARS = /[。、．，！？.!?…\s]+/g;

function canonical(s: string): string {
  return s.replace(NOISE_CHARS, "").toLowerCase();
}

/** Collapse the transcript to its "meaningful" core so a segment that is nothing
 *  but hallucinated boilerplate (possibly repeated, possibly punctuated) reduces
 *  to the empty string and gets dropped. */
function isPureHallucination(trimmed: string): boolean {
  let remaining = canonical(trimmed);
  if (remaining.length === 0) return false;
  const phrases = [...HALLUCINATION_PHRASES].map(canonical).sort((a, b) => b.length - a.length);
  let changed = true;
  while (changed && remaining.length > 0) {
    changed = false;
    for (const phrase of phrases) {
      while (remaining.startsWith(phrase)) {
        remaining = remaining.slice(phrase.length);
        changed = true;
      }
    }
  }
  return remaining.length === 0;
}

export function normalizeTranscript(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (BLANK_MARKERS.has(trimmed.toLowerCase())) return "";
  if (isPureHallucination(trimmed)) return "";
  return trimmed;
}

export function createWhisper(opts: WhisperOptions): Whisper {
  const { modelsDir } = opts;
  const logger = opts.logger ?? NOOP_LOGGER;
  const ffmpegBinary = opts.ffmpegBinary ?? "ffmpeg";
  const downloader = createModelDownloader(modelsDir, logger);
  const sidecar = createSidecar(modelsDir, opts.serverBinary ?? "whisper-server", logger);

  // Scratch dir for transient audio — a hidden subdir of the models dir so it
  // shares the (non-git) models tree. Files are deleted after each transcription.
  const scratchDir = path.join(modelsDir, ".scratch");

  async function transcribe(req: TranscribeRequest): Promise<{ text: string }> {
    mkdirSync(scratchDir, { recursive: true });
    const clipId = randomUUID();
    const inputPath = path.join(scratchDir, `utterance-${clipId}.webm`);
    const wavPath = path.join(scratchDir, `utterance-${clipId}.wav`);
    try {
      await writeFile(inputPath, Buffer.from(req.base64, "base64"));
      await convertToWav16k(inputPath, wavPath, ffmpegBinary);
      const text = await sidecar.transcribeWav(wavPath, req.language, req.model);
      return { text: normalizeTranscript(text) };
    } finally {
      await rm(inputPath, { force: true });
      await rm(wavPath, { force: true });
    }
  }

  return {
    isModelReady: (model) => isModelReady(modelsDir, model),
    getModelStatus: (model) => downloader.getStatus(model),
    ensureModelDownloaded: (model) => downloader.ensure(model),
    warmup: (model) => sidecar.warmup(model),
    transcribe,
    shutdown: () => sidecar.shutdown(),
  };
}
