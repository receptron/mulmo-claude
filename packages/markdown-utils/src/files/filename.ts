// Strip filesystem-hostile chars from a string so it can safely be used
// as a browser download filename across Windows / macOS / Linux. Not a
// full slugifier — server-side slugification lives in
// `server/utils/slug.ts` and is applied before data hits the client.
// This helper is the last-line defensive escape for plugin views that
// build a download filename from arbitrary title text.
const UNSAFE_FILENAME_CHARS = /[/\\:*?"<>|]/g;

export function toSafeFilename(name: string, fallback = "download"): string {
  const cleaned = name.replace(UNSAFE_FILENAME_CHARS, "_").trim();
  return cleaned || fallback;
}

// Format a millisecond timestamp as YYYY-MM-DD in the user's local
// timezone. Used by buildPdfFilename so the date suffix matches the
// user's wall clock — not UTC, which can confuse users near midnight
// in non-UTC zones.
export function formatLocalDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Build a PDF download filename of the form `name-YYYY-MM-DD.pdf`.
// The `name` is sanitized via toSafeFilename and falls back to
// `fallback` when empty / nullish. `timestampMs` defaults to now —
// callers pass the result's creation timestamp when available so the
// date reflects when the content was produced, not when the user
// clicked download.
export function buildPdfFilename(opts: { name: string | null | undefined; fallback: string; timestampMs?: number }): string {
  const safe = toSafeFilename(opts.name ?? "", opts.fallback);
  const date = formatLocalDate(opts.timestampMs ?? Date.now());
  return `${safe}-${date}.pdf`;
}
