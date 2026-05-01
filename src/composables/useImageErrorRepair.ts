import { onMounted, onBeforeUnmount } from "vue";
import { IMAGE_REPAIR_PATTERN, IMAGE_REPAIR_INLINE_SCRIPT } from "../utils/image/imageRepairInlineScript.js";

// Re-exported from the pure module so existing callers keep working.
// New callers (server/index.ts splice, future iframe-injection
// surfaces) should import from `../utils/image/imageRepairInlineScript.js`
// directly to avoid pulling Vue lifecycle hooks into Node code paths.
export { IMAGE_REPAIR_PATTERN, IMAGE_REPAIR_INLINE_SCRIPT };

// Whitespace- and comma-bounded URL token inside a `srcset` value.
// `srcset` is a comma-list of `<url> [descriptor]` entries; the
// regex picks each non-whitespace, non-comma run so the descriptor
// (`1x`, `2x`, `100w`, …) survives the repair pass untouched.
const SRCSET_TOKEN_RE = /[^\s,]+/g;

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
