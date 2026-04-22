// Turn Whisper's `chunks` output into a timestamped block of text
// that reads well when pasted into a chat message.
//
// Shape of a chunk (from @xenova/transformers ASR pipeline with
// return_timestamps: true):
//   { timestamp: [startSec, endSec] | null, text: string }
//
// Example output:
//   [0:00-0:04] まず今日のスケジュールを確認します
//   [0:04-0:09] 次に、プロジェクト A の進捗について

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

// Shape-loose so callers can pass Whisper's raw chunks as-is — the
// library sometimes emits `timestamp: [null, null]`, sometimes a
// 2-tuple, sometimes a bare array literal. We validate at runtime
// rather than forcing callers to cast.
interface RawChunk {
  readonly timestamp?: readonly (number | null | undefined)[] | null;
  readonly text?: string;
}

export function toSegments(chunks: readonly RawChunk[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const chunk of chunks) {
    const text = typeof chunk.text === "string" ? chunk.text.trim() : "";
    if (!text) continue;
    const stamp = chunk.timestamp;
    const first = Array.isArray(stamp) ? stamp[0] : undefined;
    const second = Array.isArray(stamp) ? stamp[1] : undefined;
    const start = typeof first === "number" ? first : 0;
    const end = typeof second === "number" ? second : start;
    segments.push({ start, end, text });
  }
  return segments;
}

export function formatTranscript(segments: readonly TranscriptSegment[]): string {
  if (segments.length === 0) return "";
  return segments.map((seg) => `[${formatTime(seg.start)}-${formatTime(seg.end)}] ${seg.text}`).join("\n");
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const totalSec = Math.floor(seconds);
  const minutes = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
