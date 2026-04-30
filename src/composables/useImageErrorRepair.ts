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
//
// Stage E (umbrella #1011) extends the same self-repair to <source>
// elements (used by <picture> / <audio> / <video>) so wrong-prefix
// `srcset` / `src` attributes get the same one-shot rewrite.
export const IMAGE_REPAIR_PATTERN = /artifacts\/images\/.+/;

// Whitespace- and comma-bounded URL token inside a `srcset` value.
// `srcset` is a comma-list of `<url> [descriptor]` entries; the
// regex picks each non-whitespace, non-comma run so the descriptor
// (`1x`, `2x`, `100w`, …) survives the repair pass untouched.
const SRCSET_TOKEN_RE = /[^\s,]+/g;

// Inline script body intended for iframe surfaces (presentHtml,
// Files HTML preview, …). Same decision tree as
// `useGlobalImageErrorRepair` below; kept as a string so it can be
// embedded into the rendered HTML and run inside the iframe. The
// regex literal is interpolated from `IMAGE_REPAIR_PATTERN` so the
// two stay in lock step automatically.
//
// **Currently not wired up.** When presentHtml moved off `srcdoc`
// onto `/artifacts/html` static mounts, the original injection
// site disappeared. Re-wiring is tracked in #1025. Until that
// lands, only the document-scope handler from
// `useGlobalImageErrorRepair` is active in the app shell.
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

export function repairImageSrc(img: HTMLImageElement): boolean {
  if (img.dataset.imageRepairTried) return false;
  // Set the one-shot marker only AFTER confirming the URL matches the
  // repair pattern. Otherwise an unrelated 404 (different domain, no
  // artifacts/images segment) would pin the marker and silently block
  // any future repair attempt on the same DOM element if the src is
  // later replaced with a repairable one.
  const match = img.src.match(IMAGE_REPAIR_PATTERN);
  if (!match) return false;
  img.dataset.imageRepairTried = "1";
  img.src = `/${match[0]}`;
  return true;
}

// Repair a `<source>` element used inside `<picture>` / `<audio>` /
// `<video>`. Handles both shapes:
//   - `srcset="..."` (the picture form, often comma-list with size
//     descriptors)
//   - `src="..."` (the audio/video form, single URL)
// One-shot via the same `imageRepairTried` marker as <img>.
export function repairSourceSrc(source: HTMLSourceElement): boolean {
  if (source.dataset.imageRepairTried) return false;
  let repaired = false;
  const src = source.getAttribute("src");
  if (src) {
    const match = src.match(IMAGE_REPAIR_PATTERN);
    if (match) {
      source.setAttribute("src", `/${match[0]}`);
      repaired = true;
    }
  }
  if (source.srcset) {
    const original = source.srcset;
    const next = original.replace(SRCSET_TOKEN_RE, (token) => {
      const tokenMatch = token.match(IMAGE_REPAIR_PATTERN);
      return tokenMatch ? `/${tokenMatch[0]}` : token;
    });
    if (next !== original) {
      source.srcset = next;
      repaired = true;
    }
  }
  if (repaired) source.dataset.imageRepairTried = "1";
  return repaired;
}

// Attach a document-level capture-phase error listener so any
// `<img>` / `<source>` / `<audio>` / `<video>` 404 in the app
// shell (wiki / markdown / news / Files preview etc) gets one
// repair attempt. Capture phase is required because the relevant
// error events don't bubble. The repair is a no-op for src values
// that don't match the artifacts/images pattern, so attaching at
// document scope is safe — it never touches non-image-bearing UI.
export function useGlobalImageErrorRepair(): void {
  function onError(event: Event): void {
    const { target } = event;
    if (target instanceof HTMLImageElement) {
      repairImageSrc(target);
      // Source-element error events don't fire reliably in Chromium
      // when a `<picture><source>` srcset 404s — only the inner
      // `<img>` reaches a target. Walk siblings so a wrong-prefix
      // `<source>` next to a repairable `<img>` gets the same fix.
      const picture = target.closest("picture");
      if (picture) {
        for (const src of picture.querySelectorAll("source")) {
          repairSourceSrc(src);
        }
      }
    } else if (target instanceof HTMLSourceElement) {
      repairSourceSrc(target);
    } else if (target instanceof HTMLMediaElement) {
      // `<audio>` / `<video>` fire `error` on themselves when ALL
      // their `<source>` children fail. The source elements never
      // get a target of their own in that path, so reach into
      // each child and repair it.
      for (const src of target.querySelectorAll<HTMLSourceElement>(":scope > source")) {
        repairSourceSrc(src);
      }
    }
  }

  onMounted(() => {
    document.addEventListener("error", onError, { capture: true });
  });

  onBeforeUnmount(() => {
    document.removeEventListener("error", onError, { capture: true });
  });
}
