import { onMounted, onBeforeUnmount } from "vue";

// All Gemini / canvas / image-edit output lives at
// `artifacts/images/YYYY/MM/<id>.png` (see server/utils/files/image-store.ts).
// If a rendered <img>'s src happens to embed that segment somewhere
// (e.g. an LLM emitted `<img src="../wrong/prefix/artifacts/images/foo.png">`
// or the rewriter missed a single-quoted attribute), trim everything before
// the pattern and retry as `/artifacts/images/<rest>` — the static mount
// added in stage 1 (server/index.ts) will then serve the file directly.
//
// Stage 3 of the image-path-routing redesign — see
// plans/feat-image-path-routing.md and
// docs/discussion-image-path-routing.md.
export const IMAGE_REPAIR_PATTERN = /artifacts\/images\/.+/;

// Inline script body that the presentHtml plugin injects into its
// iframe srcdoc. Same logic as `repairImageSrc` below; kept as a
// string so it can be embedded into the rendered HTML and run in the
// sandboxed iframe. Update both together if the repair rule changes.
export const IMAGE_REPAIR_INLINE_SCRIPT = `
document.addEventListener("error", function (event) {
  var target = event.target;
  if (!target || target.tagName !== "IMG") return;
  if (target.dataset.imageRepairTried) return;
  target.dataset.imageRepairTried = "1";
  var match = String(target.src).match(/artifacts\\/images\\/.+/);
  if (!match) return;
  target.src = "/" + match[0];
}, true);
`.trim();

export function repairImageSrc(img: HTMLImageElement): boolean {
  if (img.dataset.imageRepairTried) return false;
  img.dataset.imageRepairTried = "1";
  const match = img.src.match(IMAGE_REPAIR_PATTERN);
  if (!match) return false;
  img.src = `/${match[0]}`;
  return true;
}

// Attach a document-level capture-phase error listener so any <img>
// 404 in the app shell (wiki / markdown / news / Files preview etc)
// gets one repair attempt. Capture phase is required because <img>
// error events don't bubble. The repair is a no-op for src values
// that don't match the artifacts/images pattern, so attaching at
// document scope is safe — it never touches non-image-bearing UI.
export function useGlobalImageErrorRepair(): void {
  function onError(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLImageElement) repairImageSrc(target);
  }

  onMounted(() => {
    document.addEventListener("error", onError, { capture: true });
  });

  onBeforeUnmount(() => {
    document.removeEventListener("error", onError, { capture: true });
  });
}
