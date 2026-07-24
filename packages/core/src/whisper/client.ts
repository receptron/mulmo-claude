// @mulmoclaude/core/whisper/client — framework-neutral browser capture controller.
// Records one utterance at a time with MediaRecorder, segments on pauses via a
// Web Audio VAD, and sends each segment through an injected transport. State is
// pushed via `onState`; the host wraps this into its own reactivity (Vue refs,
// React state, …). No framework dependency. See plans/done/feat-extract-whisper-package.md.

import { computeRms, containerTypeFromMime, evaluateVad, type VadConfig } from "./client-helpers.ts";

// Map a UI locale to a Whisper language code. UI language is a strong prior for
// the spoken language; "auto" lets Whisper detect it from the audio.
const LOCALE_TO_WHISPER: Record<string, string> = {
  en: "en",
  ja: "ja",
  zh: "zh",
  ko: "ko",
  es: "es",
  "pt-BR": "pt",
  fr: "fr",
  de: "de",
};

export function localeToWhisperLanguage(locale: string): string {
  return LOCALE_TO_WHISPER[locale] ?? "auto";
}

// VAD tuning. RMS over [-1,1] float samples; a pause is SILENCE_MS of
// sub-threshold level after speech. MAX_SEGMENT_MS force-cuts a long unbroken
// utterance so no clip exceeds Whisper's 30s window or the server's size cap.
const SPEECH_RMS = 0.015;
const SILENCE_MS = 800;
const MAX_SEGMENT_MS = 20_000;
const MONITOR_INTERVAL_MS = 100;
const AVAILABILITY_POLL_MS = 2_000;
const VAD_CONFIG: VadConfig = { speechRms: SPEECH_RMS, silenceMs: SILENCE_MS, maxSegmentMs: MAX_SEGMENT_MS };

function pickRecorderMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  if (typeof MediaRecorder === "undefined") return undefined;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- FileReader.result is `string | ArrayBuffer | null`; readAsDataURL always yields the string branch, and the rule cannot narrow it.
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface VoiceCaptureTransport {
  /** Transcribe one segment. Throws on failure. */
  transcribe: (dataUrl: string, language: string) => Promise<{ text: string }>;
  /** Current readiness. `downloading` true keeps the controller polling so it
   *  flips to ready as soon as a model download finishes. */
  getStatus: () => Promise<{ ready: boolean; downloading: boolean }>;
}

export interface VoiceCaptureState {
  available: boolean;
  listening: boolean;
  transcribing: boolean;
}

export interface VoiceCaptureCallbacks {
  /** A recognized (non-empty) segment transcript. */
  onTranscript: (text: string) => void;
  /** A segment produced no speech. */
  onEmpty?: () => void;
  /** A recoverable error message (transport failure, permission denied, etc.). */
  onError?: (message: string) => void;
  /** Pushed whenever available/listening/transcribing changes. */
  onState?: (state: VoiceCaptureState) => void;
}

export interface VoiceCapture {
  refreshAvailability: () => Promise<void>;
  start: () => Promise<boolean>;
  stop: () => void;
  dispose: () => void;
}

export interface CaptureStateController {
  setAvailable: (value: boolean) => void;
  setListening: (value: boolean) => void;
  setPending: (delta: number) => void;
  isListening: () => boolean;
}

// Owns the three observable flags. Each setter emits only on an actual change so
// the host's reactivity never churns on a no-op write. `pending` is a private
// counter; `transcribing` is true exactly while at least one send is in flight.
export function createCaptureState(onState?: (state: VoiceCaptureState) => void): CaptureStateController {
  let available = false;
  let listening = false;
  let transcribing = false;
  let pending = 0;

  function emit(): void {
    onState?.({ available, listening, transcribing });
  }
  function setAvailable(value: boolean): void {
    if (available !== value) {
      available = value;
      emit();
    }
  }
  function setListening(value: boolean): void {
    if (listening !== value) {
      listening = value;
      emit();
    }
  }
  function setPending(delta: number): void {
    pending += delta;
    const next = pending > 0;
    if (transcribing !== next) {
      transcribing = next;
      emit();
    }
  }

  return { setAvailable, setListening, setPending, isListening: () => listening };
}

export interface AvailabilityPoller {
  refresh: () => Promise<void>;
  stop: () => void;
}

// Owns the polling timer. `refresh` mirrors transport readiness into
// `setAvailable`; while a model is downloading it self-schedules so `available`
// flips as soon as the download finishes. A `getStatus` throw fails closed
// (unavailable) and tears the timer down.
export function createAvailabilityPoller(transport: VoiceCaptureTransport, setAvailable: (value: boolean) => void): AvailabilityPoller {
  let availabilityPollHandle: number | null = null;

  function stop(): void {
    if (availabilityPollHandle !== null) {
      window.clearInterval(availabilityPollHandle);
      availabilityPollHandle = null;
    }
  }

  async function refresh(): Promise<void> {
    let status: { ready: boolean; downloading: boolean };
    try {
      status = await transport.getStatus();
    } catch {
      setAvailable(false);
      stop();
      return;
    }
    setAvailable(status.ready);
    if (status.downloading) {
      if (availabilityPollHandle === null) {
        availabilityPollHandle = window.setInterval(() => {
          void refresh();
        }, AVAILABILITY_POLL_MS);
      }
    } else {
      stop();
    }
  }

  return { refresh, stop };
}

export interface SegmentQueueOptions {
  transport: VoiceCaptureTransport;
  language: () => string;
  callbacks: VoiceCaptureCallbacks;
  setPending: (delta: number) => void;
  // Read-only epoch seam: the queue never mutates the generation, it only reads
  // the parent's current value to drop segments captured under an older session.
  getGeneration: () => number;
}

export interface SegmentQueue {
  enqueue: (blob: Blob, gen: number) => void;
}

// Owns the serialized send chain. Each blob is transcribed in capture order; the
// generation is checked at entry and again after transcription so a segment
// belonging to a session the user already left is dropped silently.
export function createSegmentQueue(options: SegmentQueueOptions): SegmentQueue {
  const { transport, language, callbacks, setPending, getGeneration } = options;
  let queue: Promise<void> = Promise.resolve();

  async function sendSegment(blob: Blob, gen: number): Promise<void> {
    if (gen !== getGeneration()) return;
    try {
      const dataUrl = await blobToDataUrl(blob);
      const result = await transport.transcribe(dataUrl, language());
      if (gen !== getGeneration()) return;
      const text = result.text.trim();
      if (text.length === 0) callbacks.onEmpty?.();
      else callbacks.onTranscript(text);
    } catch (err) {
      // Generation-guard the failure path too: a send rejected after stop()/
      // session change belongs to a session the user already left.
      if (gen === getGeneration()) callbacks.onError?.(toMessage(err));
    }
  }

  // Serialize sends so transcripts append in capture order; `pending` keeps
  // `transcribing` true from enqueue until the send resolves.
  function enqueue(blob: Blob, gen: number): void {
    setPending(1);
    queue = queue
      .then(() => sendSegment(blob, gen))
      .catch(() => undefined)
      .finally(() => setPending(-1));
  }

  return { enqueue };
}

export interface AudioGraph {
  /** True between `attach()` and the next `teardown()`. */
  isAttached: () => boolean;
  /** Read the current PCM window into an internal buffer and return it.
   *  Callers must not mutate the returned array. */
  sample: () => Float32Array;
  /** Live mic stream — the outer needs it to hand to MediaRecorder. */
  getStream: () => MediaStream | null;
  /** Attach a fresh mic stream: create AudioContext + AnalyserNode + VAD buffer,
   *  connect the source. Called only by `bootstrapCapture` after the caller has
   *  passed the stale-generation / permission checks. */
  attach: (stream: MediaStream) => void;
  /** Close the AudioContext, stop the mic tracks, null everything. Safe to
   *  call before `attach()` or twice in a row. */
  teardown: () => void;
}

// Owns the browser-side audio pipeline: mic stream + AudioContext + AnalyserNode
// + the reusable Float32 buffer VAD reads samples into. Separated from
// `createVoiceCapture` so its four browser-API fields don't inflate the parent
// factory's line count and so the setup/teardown ordering is in one place.
function createAudioGraph(): AudioGraph {
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let vadBuffer = new Float32Array(0);

  function attach(nextStream: MediaStream): void {
    stream = nextStream;
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    vadBuffer = new Float32Array(analyser.fftSize);
    audioCtx.createMediaStreamSource(nextStream).connect(analyser);
  }

  function sample(): Float32Array {
    analyser?.getFloatTimeDomainData(vadBuffer);
    return vadBuffer;
  }

  function teardown(): void {
    if (audioCtx) {
      audioCtx.close().catch(() => undefined);
      audioCtx = null;
    }
    analyser = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  return { isAttached: () => analyser !== null, sample, getStream: () => stream, attach, teardown };
}

interface BootstrappedCapture {
  audioGraph: AudioGraph;
  mimeType: string;
}

// Acquire the mic + probe MediaRecorder support + wire an AudioGraph, returning
// null (with `callbacks.onError` fired) on any recoverable failure. Deliberately
// does NOT touch `state` or start the recorder — the caller commits the session
// only after this resolves successfully, so a stale `generation` detected mid-
// flight can drop the tracks and bail without partially publishing state.
async function bootstrapCapture(callbacks: VoiceCaptureCallbacks, generationAtStart: number, generationNow: () => number): Promise<BootstrappedCapture | null> {
  const mimeType = pickRecorderMime() ?? "";
  if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
    callbacks.onError?.("unsupported");
    return null;
  }
  let acquired: MediaStream;
  try {
    acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    callbacks.onError?.("permission-denied");
    return null;
  }
  if (generationAtStart !== generationNow()) {
    acquired.getTracks().forEach((track) => track.stop());
    return null;
  }
  const audioGraph = createAudioGraph();
  try {
    audioGraph.attach(acquired);
  } catch (err) {
    // teardown() is null-safe and closes any half-created AudioContext AND
    // stops the mic tracks — the pre-refactor code only stopped tracks and
    // leaked the context (codex/CodeRabbit findings on this PR).
    audioGraph.teardown();
    throw err;
  }
  return { audioGraph, mimeType };
}

export interface RecorderSession {
  isRecording: () => boolean;
  hadSpeech: () => boolean;
  markSpeech: () => void;
  /** Start a new segment on `stream`, tagged with `gen`. Resets per-segment
   *  state (chunks + hadSpeech) synchronously so a subsequent VAD tick sees
   *  a fresh window. */
  startNext: (stream: MediaStream, mimeType: string, gen: number) => void;
  /** Force-close the current segment (silence exceeded or MAX_SEGMENT_MS). */
  cut: () => void;
}

interface RecorderSessionDeps {
  /** Fires each time a segment finishes. The parent decides whether to
   *  restart (via `session.startNext`) and whether to enqueue the blob. */
  onSegmentEnd: (blob: Blob, hadSpeech: boolean, gen: number) => void;
}

// Owns MediaRecorder + its per-segment scratchpad (chunks, hadSpeech, gen,
// mimeType). The parent keeps VAD state and the global generation, and calls
// `startNext` on both initial-start and post-onstop restart paths.
function createRecorderSession(deps: RecorderSessionDeps): RecorderSession {
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let segmentHasSpeech = false;
  let sessionGen = 0;
  let sessionMimeType = "";

  function onStop(): void {
    // Snapshot BEFORE the parent's onSegmentEnd callback runs; `startNext`
    // (if the parent chooses to restart) will clear chunks synchronously.
    const hadSpeech = segmentHasSpeech;
    const gen = sessionGen;
    const blob = new Blob(chunks, { type: containerTypeFromMime(sessionMimeType) });
    deps.onSegmentEnd(blob, hadSpeech, gen);
  }

  function startNext(stream: MediaStream, mimeType: string, gen: number): void {
    chunks = [];
    segmentHasSpeech = false;
    sessionGen = gen;
    sessionMimeType = mimeType;
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = onStop;
    recorder.start();
  }

  return {
    isRecording: () => recorder?.state === "recording",
    hadSpeech: () => segmentHasSpeech,
    markSpeech: () => {
      segmentHasSpeech = true;
    },
    startNext,
    cut: () => {
      if (recorder?.state === "recording") recorder.stop();
    },
  };
}

// Zero-values used to seed a fresh `CaptureRuntime` at the top of every
// `createVoiceCapture` call. Kept module-scope so the seed doesn't inflate the
// factory's line count.
const INITIAL_RUNTIME: Readonly<CaptureRuntime> = {
  audioGraph: null,
  monitorHandle: null,
  mimeType: "",
  silenceStart: null,
  segmentStart: 0,
  generation: 0,
  startInFlight: false,
};

// Mutable capture-time state, kept as one object so module-scope helpers
// (`stopCapture`, `monitorTick`) can be typed against one shape rather than
// threading each field through their signatures.
interface CaptureRuntime {
  audioGraph: AudioGraph | null;
  monitorHandle: number | null;
  mimeType: string;
  silenceStart: number | null;
  segmentStart: number;
  /** Bumped on stop(); segments captured under an older value are dropped so a
   *  late transcript never leaks across sessions. */
  generation: number;
  /** Single-flight guard on start() — true between entry and completion so a
   *  second start can't race the first before `listening` flips. */
  startInFlight: boolean;
}

// Tear down the browser-side resources. `state.setListening(false)` MUST happen
// BEFORE `session.cut()` so the parent's onSegmentEnd callback sees
// isListening()===false and does NOT restart. The monitor interval MUST clear
// BEFORE `audioGraph.teardown()` so a scheduled tick can't run against a
// half-closed AudioContext.
function stopCapture(runtime: CaptureRuntime, state: CaptureStateController, session: RecorderSession): void {
  runtime.generation += 1;
  state.setListening(false);
  if (runtime.monitorHandle !== null) {
    window.clearInterval(runtime.monitorHandle);
    runtime.monitorHandle = null;
  }
  session.cut();
  runtime.audioGraph?.teardown();
  runtime.audioGraph = null;
}

// One VAD tick against the audio graph's current window. No-op when the graph
// is not attached (defensive: `stopCapture` clears `monitorHandle` before
// `audioGraph.teardown()`, so this is the belt-and-braces for any late fire).
function monitorTick(runtime: CaptureRuntime, session: RecorderSession): void {
  if (!runtime.audioGraph?.isAttached()) return;
  const rms = computeRms(runtime.audioGraph.sample());
  const {
    hasSpeech,
    silenceStart: nextSilence,
    cut,
  } = evaluateVad({ hasSpeech: session.hadSpeech(), silenceStart: runtime.silenceStart }, runtime.segmentStart, rms, Date.now(), VAD_CONFIG);
  if (hasSpeech) session.markSpeech();
  runtime.silenceStart = nextSilence;
  if (cut) session.cut();
}

export function createVoiceCapture(transport: VoiceCaptureTransport, language: () => string, callbacks: VoiceCaptureCallbacks): VoiceCapture {
  const state = createCaptureState(callbacks.onState);
  const poller = createAvailabilityPoller(transport, state.setAvailable);
  const runtime: CaptureRuntime = { ...INITIAL_RUNTIME };
  const segments = createSegmentQueue({ transport, language, callbacks, setPending: state.setPending, getGeneration: () => runtime.generation });

  const session = createRecorderSession({ onSegmentEnd: handleSegmentEnd });

  function handleSegmentEnd(blob: Blob, hadSpeech: boolean, gen: number): void {
    // Restart FIRST so audio-loss between segments is minimal; the snapshot
    // in blob/hadSpeech/gen is already independent of session state.
    if (state.isListening()) startRecorder();
    if (hadSpeech && blob.size > 0 && gen === runtime.generation) segments.enqueue(blob, gen);
  }

  function startRecorder(): void {
    const stream = runtime.audioGraph?.getStream();
    if (!stream) return;
    runtime.silenceStart = null;
    runtime.segmentStart = Date.now();
    session.startNext(stream, runtime.mimeType, runtime.generation);
  }

  async function start(): Promise<boolean> {
    if (runtime.startInFlight || state.isListening()) return true;
    runtime.startInFlight = true;
    const startGen = runtime.generation;
    try {
      const capture = await bootstrapCapture(callbacks, startGen, () => runtime.generation);
      if (!capture) return false;
      runtime.audioGraph = capture.audioGraph;
      runtime.mimeType = capture.mimeType;
      state.setListening(true);
      startRecorder();
      runtime.monitorHandle = window.setInterval(() => monitorTick(runtime, session), MONITOR_INTERVAL_MS);
      return true;
    } finally {
      runtime.startInFlight = false;
    }
  }

  function stop(): void {
    stopCapture(runtime, state, session);
  }

  function dispose(): void {
    poller.stop();
    stop();
  }

  return { refreshAvailability: poller.refresh, start, stop, dispose };
}
