// File type gate for ChatInput's audio drop path.
//
// Browsers disagree about what MIME type to report for audio (macOS
// Safari often sends nothing at all for `.m4a`, Windows sometimes
// sends `application/octet-stream`), so we check extension as a
// fallback. `AudioContext.decodeAudioData` will be the final arbiter
// of whether a file can actually be decoded — we just use this
// function to decide "do we even try the audio path?".

const AUDIO_EXTENSIONS = new Set([
  // mpeg / AAC family
  "mp3",
  "m4a",
  "mp4a",
  "aac",
  // wav
  "wav",
  "wave",
  // ogg family
  "ogg",
  "oga",
  "opus",
  // flac
  "flac",
  // webm (audio-only containers)
  "webm",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "avi", "m4v"]);

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  const ext = fileExtension(file);
  return AUDIO_EXTENSIONS.has(ext);
}

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return VIDEO_EXTENSIONS.has(fileExtension(file));
}

function fileExtension(file: File): string {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1) : "";
}
