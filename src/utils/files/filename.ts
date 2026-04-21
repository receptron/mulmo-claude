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
