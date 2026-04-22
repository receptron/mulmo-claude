// Browser-only Whisper transcription for ChatInput's audio drop flow.
//
// Lazy-loads @xenova/transformers and the `whisper-base` model
// (~74 MB). The model is cached in IndexedDB by Transformers.js, so
// the 74 MB download is a one-time cost per browser profile.
//
// Exposes a state ref that the UI watches to render progress. We
// deliberately avoid a singleton pipeline across component remounts
// by caching at module scope — the composable itself can be mounted
// multiple times cheaply.

import { shallowRef, type Ref } from "vue";
import { toSegments, formatTranscript, type TranscriptSegment } from "../utils/audio/formatTranscript";

const WHISPER_MODEL = "Xenova/whisper-base";
const TARGET_SAMPLE_RATE = 16_000;

export type TranscribeState =
  | { status: "idle" }
  | { status: "loading-model"; progress: number } // 0..1
  | { status: "decoding-audio" }
  | { status: "transcribing" }
  | { status: "done"; text: string; segments: TranscriptSegment[] }
  | { status: "error"; error: string };

interface AsrPipeline {
  (
    input: Float32Array,
    options: { return_timestamps: boolean; chunk_length_s: number; stride_length_s: number; language: string | null },
  ): Promise<{ text: string; chunks?: readonly { timestamp?: readonly (number | null | undefined)[] | null; text?: string }[] }>;
}

interface ProgressEvent {
  status: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

let pipelinePromise: Promise<AsrPipeline> | null = null;

async function loadPipeline(onProgress: (ev: ProgressEvent) => void): Promise<AsrPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const mod = await import("@xenova/transformers");
      // Returns a callable pipeline; the cast is a seam between the
      // library's any-leaning types and our strict shape above.
      const pipeline = (await mod.pipeline("automatic-speech-recognition", WHISPER_MODEL, {
        progress_callback: onProgress,
      })) as unknown as AsrPipeline;
      return pipeline;
    })().catch((err) => {
      // Reset so a later retry can start fresh after a transient
      // network failure during the model download.
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

// Decode arbitrary audio (whatever the browser supports) to a mono
// Float32Array at 16 kHz. Uses OfflineAudioContext for resampling so
// we don't need to implement a sinc filter ourselves — every
// mainstream browser supports arbitrary target rates on Offline*.
async function decodeTo16kMono(file: File): Promise<Float32Array> {
  const buffer = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    if (decoded.sampleRate === TARGET_SAMPLE_RATE && decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0).slice();
    }
    const targetLength = Math.ceil((decoded.duration * TARGET_SAMPLE_RATE) / 1);
    const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    // `close()` returns a Promise we don't await — fire-and-forget
    // is fine here because the AudioContext is scoped to this call.
    ctx.close().catch(() => {
      /* ignore */
    });
  }
}

export function useWhisperTranscribe(): {
  state: Ref<TranscribeState>;
  transcribe: (file: File) => Promise<void>;
  reset: () => void;
} {
  const state = shallowRef<TranscribeState>({ status: "idle" });

  function reset(): void {
    state.value = { status: "idle" };
  }

  async function transcribe(file: File): Promise<void> {
    try {
      state.value = { status: "loading-model", progress: 0 };
      const pipe = await loadPipeline((event) => {
        // Transformers.js emits events with status like "progress",
        // "download", "done" — we only surface download progress.
        const progress = typeof event.progress === "number" ? event.progress / 100 : undefined;
        if (typeof progress === "number" && state.value.status === "loading-model") {
          state.value = { status: "loading-model", progress };
        }
      });

      state.value = { status: "decoding-audio" };
      const audio = await decodeTo16kMono(file);

      state.value = { status: "transcribing" };
      const result = await pipe(audio, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        language: null,
      });

      const segments = toSegments(result.chunks ?? []);
      const text = segments.length > 0 ? formatTranscript(segments) : result.text.trim();
      state.value = { status: "done", text, segments };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.value = { status: "error", error: message };
    }
  }

  return { state, transcribe, reset };
}

// Exported only for testability of the module-scoped cache.
export function __resetPipelineCacheForTesting(): void {
  pipelinePromise = null;
}

// Re-exports for consumers that want to render segments directly.
export { formatTranscript, type TranscriptSegment };
