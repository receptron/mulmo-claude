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
// Matches the onnxruntime-web version bundled by @xenova/transformers
// @2.17.x. If transformers.js is upgraded, this must be kept in sync
// (package.json listing of onnxruntime-web, or the peer dep the
// library pulls in).
const ORT_WASM_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/";

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

// Always-on fetch trace during the whisper pipeline load. Output is
// on `console.info` so normal dev logs aren't overrun — filter the
// console for `[whisper]` to see just this.
//
// We install a fetch wrapper via `env.customFetch` if the library
// supports it, and ALSO monkey-patch globalThis.fetch as a fallback.
// Some users run under SES (MetaMask etc.) which freezes intrinsics
// and silently prevents globalThis reassignment — we can't detect
// that without a probe, so we do both and hope at least one sticks.
function wrapFetch(originalFetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const started = performance.now();
    try {
      const response = await originalFetch(input, init);
      const contentType = response.headers.get("content-type") ?? "";
      const elapsed = (performance.now() - started).toFixed(0);
      let peek = "";
      if (contentType.includes("html") || contentType.includes("json") || contentType === "") {
        try {
          peek = (await response.clone().text()).slice(0, 120).replace(/\s+/g, " ");
        } catch {
          /* ignore — clone may fail on some exotic responses */
        }
      }
      const suffix = peek ? ` | ${peek}` : "";
      console.info(`[whisper] ${response.status} ${elapsed}ms ${contentType || "(no ct)"} ${url}${suffix}`);
      return response;
    } catch (err) {
      console.error(`[whisper] FETCH FAILED ${url}`, err);
      throw err;
    }
  };
}

function installFetchSpy(): () => void {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const spy = wrapFetch(originalFetch);
  // Assignment may fail silently under SES — the try/catch is belt-
  // and-braces. If assignment fails, we still have env.customFetch
  // below as a backup.
  let installed = false;
  try {
    globalThis.fetch = spy;
    installed = globalThis.fetch === spy;
  } catch {
    installed = false;
  }
  console.info(`[whisper] fetch spy installed=${installed}`);
  return () => {
    if (installed) {
      try {
        globalThis.fetch = originalFetch;
      } catch {
        /* ignore — can't put it back, but the process is ending anyway */
      }
    }
  };
}

async function loadPipeline(onProgress: (ev: ProgressEvent) => void): Promise<AsrPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const mod = await import("@xenova/transformers");
      // Under Vite (and most SPA dev servers), unknown paths get the
      // index.html fallback with a 200 status. Transformers.js then
      // tries to JSON.parse HTML and surfaces:
      //   Unexpected token '<', "<!DOCTYPE "... is not valid JSON
      //
      // Two places it fetches from the page origin by default:
      //   1. Model files: `/models/<name>/...` — fix with allowLocalModels=false
      //   2. onnxruntime-web wasm blobs: relative to the JS bundle —
      //      fix by pointing wasmPaths at the CDN explicitly.
      mod.env.allowLocalModels = false;
      mod.env.allowRemoteModels = true;
      mod.env.backends.onnx.wasm.wasmPaths = ORT_WASM_CDN;
      console.info("[whisper] env config", {
        allowLocalModels: mod.env.allowLocalModels,
        allowRemoteModels: mod.env.allowRemoteModels,
        remoteHost: mod.env.remoteHost,
        remotePathTemplate: mod.env.remotePathTemplate,
        wasmPaths: mod.env.backends.onnx.wasm.wasmPaths,
      });
      const uninstallSpy = installFetchSpy();
      try {
        // Returns a callable pipeline; the cast is a seam between the
        // library's any-leaning types and our strict shape above.
        const pipeline = (await mod.pipeline("automatic-speech-recognition", WHISPER_MODEL, {
          progress_callback: onProgress,
        })) as unknown as AsrPipeline;
        return pipeline;
      } finally {
        uninstallSpy();
      }
    })().catch((err) => {
      // Dump full error chain so the console shows which step blew up
      // (JSON.parse vs fetch vs onnxruntime init) rather than just
      // the top-level message the UI surfaces.
      console.error("[whisper] pipeline load failed:", err);
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
