# Audio transcription (browser-side Whisper) — issue #594

## User prompt

> https://github.com/receptron/mulmoclaude/issues/594　音声ファイルをドロップ、プログレスバーがでて解析中、解析後、text部分にペーストするボタンを出して貼り付け可能にする でどう？よければこれでつくってみて
>
> mp3以外でもサポートできるものはサポートするようにして実装

## Goal

Drop an audio file onto ChatInput → browser-only Whisper transcribes it → preview + timestamps → user clicks **"Paste into message"** to insert the transcript into the text area.

- No server changes, no API keys, no upload. Audio bytes stay on the device.
- Support every audio format the host browser's `AudioContext.decodeAudioData` can decode — mp3 / m4a / wav / ogg / flac / aac / opus / webm-audio.
- Video files remain rejected (with a clear message), per the issue scope.

## UX (refined per issue comment 2026-04-23)

1. User drags an `.mp3` (or other supported audio) onto ChatInput — or picks it via the paperclip.
2. A **transcription preview panel** appears below the text input with a progress bar:
   - First run: `Preparing transcriber (74 MB, one-time)…` + download %
   - Then: `Decoding audio…` → `Transcribing…` (spinner)
3. On completion the panel shows the timestamped transcript and two buttons:
   - **Paste into message** — inserts the transcript into the text area (append with newline, or replace if empty)
   - **Discard** — closes the panel, nothing persists
4. The user can still attach the original audio as a regular file if they want — but the default flow is paste-into-text. **No attach path changes required.**

## Technical approach

### Dependency

- `@xenova/transformers` — browser-friendly ONNX runtime. Lazy-loaded via `await import("@xenova/transformers")` so startup bundle isn't hit with the ~500 KB loader until the user actually drops audio.
- Model: `Xenova/whisper-base` (~74 MB). Cached by Transformers.js in IndexedDB so subsequent runs load instantly.

### `src/composables/useWhisperTranscribe.ts`

State machine emitted via a `ref<TranscribeState>` union:

```ts
type TranscribeState =
  | { status: "idle" }
  | { status: "loading-model"; progress: number } // 0–1
  | { status: "decoding-audio" }
  | { status: "transcribing" }
  | { status: "done"; text: string; segments: Segment[] }
  | { status: "error"; error: string };
```

Steps:

1. **Decode** — `new AudioContext({ sampleRate: 16000 })` → `decodeAudioData(arrayBuffer)` → extract channel 0 (downmix if stereo). Resample fallback for browsers that reject non-native sample rates (rare, but guard with try/catch).
2. **Pipeline** — `pipeline("automatic-speech-recognition", "Xenova/whisper-base", { progress_callback })`. The pipeline instance is cached across calls.
3. **Transcribe** — `pipeline(float32, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, language: null })`.
4. **Format** — join `chunks[]` into `[m:ss-m:ss] text` lines.

### Format support

`AudioContext.decodeAudioData` handles container + codec natively. Rather than maintain a MIME allowlist (always wrong), we **try to decode and surface any failure as a user-visible error**. MIME-prefix check stays permissive:

```ts
function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  // Some hosts send application/octet-stream; fall back to extension.
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return ["mp3", "m4a", "mp4a", "wav", "ogg", "oga", "opus", "flac", "aac", "webm"].includes(ext);
}
```

Video (`video/*` or `.mp4` / `.webm` with video track) — reject with "video attachments not yet supported — see #594 for audio support".

### ChatInput.vue wiring

- New local state: `transcribePanelOpen`, `transcribeState` (from composable), `transcribeResult`.
- When the existing drop/pick handler sees an audio file, short-circuit the attach path and pass the `File` to the composable instead.
- Panel rendered below the text input with `v-if="transcribePanelOpen"`.
- Paste button appends `transcribeResult.text` to `message.value` (with `\n\n` separator if the field already has content) and closes the panel.
- Discard button just closes the panel.

### i18n keys

All five locales (en / ja / ko / zh / es):

```
chatInput.audioPanel: {
  preparing: "Preparing transcriber (74 MB, one-time)…",
  decoding: "Decoding audio…",
  transcribing: "Transcribing…",
  error: "Transcription failed: {error}",
  pasteButton: "Paste into message",
  discardButton: "Discard",
  videoRejected: "Video attachments aren't supported yet — please extract the audio track."
}
```

## Out of scope (deferred)

- Video decode via ffmpeg.wasm (another +20 MB WASM blob) — separate issue.
- Per-segment click-to-jump player UI.
- Model selector in Settings (whisper-small / whisper-large). v1 hardcodes `whisper-base`.
- Server-side transcription fallback for low-end devices.

## Acceptance checklist (from issue, updated)

- [ ] Drop `.mp3` onto ChatInput → transcription panel appears with progress
- [ ] Transcript preview with segment timestamps shown after completion
- [ ] "Paste into message" button inserts the transcript into the text area
- [ ] "Discard" closes the panel, no state retained
- [ ] `.mp3`, `.m4a`, `.wav`, `.ogg`, `.flac` all accepted (extension-based fallback when MIME is missing)
- [ ] Japanese and English audio both transcribe at `whisper-base` accuracy
- [ ] Second run loads model from IndexedDB cache (no re-download)
- [ ] Video files rejected with clear error message

## Files touched

| File | Change |
|---|---|
| `package.json` | `yarn add -W @xenova/transformers` |
| `src/composables/useWhisperTranscribe.ts` | **new** — state machine + ASR pipeline |
| `src/utils/audio/isAudioFile.ts` | **new** — MIME + extension gate |
| `src/utils/audio/formatTranscript.ts` | **new** — chunks → timestamped lines |
| `src/components/ChatInput.vue` | transcribe panel, audio-short-circuit in drop/pick handlers |
| `src/lang/{en,ja,ko,zh,es}.ts` | `chatInput.audioPanel` keys |
