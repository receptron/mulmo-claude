// Inline-script flavour of the image-self-repair behaviour the app
// shell already runs via `useGlobalImageErrorRepair` (see
// `src/composables/useImageErrorRepair.ts`).
//
// Iframe surfaces (presentHtml result, Files HTML preview) live in
// their own Document, so the parent's document-level error handler
// can't see their `<img>` 404s. Server-side `inlineImages` (PDF) and
// the markdown rewriter (browser) cover the deterministic-resolution
// half of the routing strategy, but iframes that load HTML files
// directly off `/artifacts/html/...` need a third leg: an in-iframe
// `error` listener that does the same one-shot repair.
//
// This module is the **pure** form (no Vue, no DOM access at module
// load) so:
//   - server/index.ts can import it for splicing into HTML responses
//   - the composable in `useImageErrorRepair.ts` re-exports it for
//     back-compat with existing test imports
//
// Stage 3 of the image-path-routing redesign — see
// plans/done/feat-image-path-routing.md and #1025.

// All Gemini / canvas / image-edit output lives at
// `artifacts/images/YYYY/MM/<id>.png` (server/utils/files/image-store.ts).
// If a rendered URL embeds that segment somewhere, trim everything
// before the pattern and retry as `/artifacts/images/<rest>` — the
// static mount will then serve the file directly.
export const IMAGE_REPAIR_PATTERN = /artifacts\/images\/.+/;

// Inline script intended for iframe surfaces. Same decision tree as
// `useGlobalImageErrorRepair`; kept as a string so it can be embedded
// into the rendered HTML and run inside the iframe. The regex literal
// is interpolated from `IMAGE_REPAIR_PATTERN` so the two stay in
// lockstep automatically.
export const IMAGE_REPAIR_INLINE_SCRIPT = `
document.addEventListener("error", function (event) {
  const target = event.target;
  if (!target) return;
  const pattern = ${IMAGE_REPAIR_PATTERN.toString()};
  function fixImg(img) {
    if (img.dataset.imageRepairTried) return;
    const m = String(img.src).match(pattern);
    if (!m) return;
    img.dataset.imageRepairTried = "1";
    img.src = "/" + m[0];
  }
  function fixSource(src) {
    if (src.dataset.imageRepairTried) return;
    let changed = false;
    const srcAttr = src.getAttribute("src");
    if (srcAttr) {
      const m = srcAttr.match(pattern);
      if (m) { src.setAttribute("src", "/" + m[0]); changed = true; }
    }
    if (src.srcset) {
      const orig = src.srcset;
      const next = orig.replace(/[^\\s,]+/g, function (tok) {
        const mm = tok.match(pattern);
        return mm ? "/" + mm[0] : tok;
      });
      if (next !== orig) { src.srcset = next; changed = true; }
    }
    if (changed) src.dataset.imageRepairTried = "1";
  }
  if (target.tagName === "IMG") {
    fixImg(target);
    const pic = target.closest && target.closest("picture");
    if (pic) for (const s of pic.querySelectorAll("source")) fixSource(s);
  } else if (target.tagName === "SOURCE") {
    fixSource(target);
  } else if (target.tagName === "AUDIO" || target.tagName === "VIDEO") {
    for (const s of target.querySelectorAll(":scope > source")) fixSource(s);
  }
}, true);
`.trim();

// Wrap the script body in a `<script>` tag once at module load; the
// splicer below uses this directly so each splice is a single string
// concatenation, not a per-request `<script>...</script>` rebuild.
const IMAGE_REPAIR_SCRIPT_TAG = `<script>${IMAGE_REPAIR_INLINE_SCRIPT}</script>`;

// `</body>` (case-insensitive, whitespace-tolerant). The previous
// implementation paired this with a `(?![\s\S]*<\/body\s*>)` negative
// lookahead to anchor at the LAST occurrence — but that lookahead is
// O(N²) on inputs with many `</body>` tokens (an adversarial / unusual
// input shape, but cheap to defang). The current implementation runs
// `matchAll` once over the input (linear) and takes the last hit, so
// the splice point selection is O(N) regardless of input shape.
const BODY_CLOSE_RE = /<\/body\s*>/gi;

/** Splice `<script>${IMAGE_REPAIR_INLINE_SCRIPT}</script>` into an
 *  HTML document just before its **last** closing `</body>`.
 *  Anchoring at the last close means nested `</body>` inside e.g.
 *  literal example text inside `<pre>` doesn't fool us into splicing
 *  too early. If the document has no `</body>` (fragments, hand-
 *  written HTML), append the tag at the end so the script still
 *  loads.
 *
 *  Pure string operation — safe to call on any HTML payload, no
 *  DOM parsing, no allocation beyond the result string. Linear time
 *  in input length even on adversarial inputs (verified by the
 *  `processes 100K </body> tokens in linear time` test). Idempotent:
 *  calling on already-spliced output appends a second copy (the
 *  script is one-shot per element so duplicates are harmless), so
 *  callers should splice exactly once per response. */
export function injectImageRepairScript(html: string): string {
  if (!html) return html;
  // matchAll → spread into an array → take the last entry. One linear
  // pass over the input regardless of how many `</body>` tokens it
  // contains.
  const matches = [...html.matchAll(BODY_CLOSE_RE)];
  if (matches.length === 0) return html + IMAGE_REPAIR_SCRIPT_TAG;
  const idx = matches[matches.length - 1].index;
  if (idx === undefined) return html + IMAGE_REPAIR_SCRIPT_TAG;
  return `${html.slice(0, idx)}${IMAGE_REPAIR_SCRIPT_TAG}${html.slice(idx)}`;
}
