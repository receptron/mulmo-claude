// Truncating preview for log payloads.
//
// Logs of user-supplied freeform text (prompts, wiki bodies, search
// queries) must never include the full body — partly to keep log
// files small, partly to limit accidental PII / secret leakage when
// logs are shared during debugging. 120 chars + an ellipsis is the
// shape the image-generation logging (PR #780) settled on; this
// module exists so other routes use the same constant rather than
// hand-rolling their own cap.
//
// Usage:
//   log.info("wiki", "page: start", { pageNamePreview: previewSnippet(pageName) });
//
// `null` / `undefined` → empty string, so the logger never has to
// guard against missing input.

const PREVIEW_CHAR_LIMIT = 120;
const ELLIPSIS = "…";

export function previewSnippet(input: string | null | undefined): string {
  if (!input) return "";
  if (input.length <= PREVIEW_CHAR_LIMIT) return input;
  return `${input.slice(0, PREVIEW_CHAR_LIMIT)}${ELLIPSIS}`;
}
