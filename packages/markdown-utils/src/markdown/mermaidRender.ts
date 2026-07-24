// Runtime side of the mermaid pipeline: scans the DOM for
// `<pre class="mermaid" data-mermaid-pending>` placeholders written by
// `mermaidExtension.ts`, lazy-loads the mermaid runtime on the first
// hit, renders each block, and swaps the placeholder in place with
// the resulting SVG.
//
// Lazy-load: mermaid.js is heavy (~500 KB gzip). The dynamic import
// keeps it out of the initial bundle for users who never encounter a
// diagram. `mermaidPromise` memoises the module so subsequent calls
// don't re-import.

type MermaidRuntime = typeof import("mermaid").default;

/** Localised strings the render pipeline surfaces when it fails.
 *  Callers (composables) resolve `t("markdownMermaid.…")` at
 *  component-setup time and hand the formatter down. Fallback
 *  defaults keep the pure module testable without a Vue / i18n
 *  runtime — they mirror the English text in `src/lang/en.ts`. */
export interface MermaidRenderLabels {
  loadFailed: (error: string) => string;
  renderFailed: (error: string) => string;
}

const DEFAULT_LABELS: MermaidRenderLabels = {
  loadFailed: (error) => `⚠ Mermaid failed to load: ${error}`,
  renderFailed: (error) => `⚠ Mermaid render failed: ${error}`,
};

let mermaidPromise: Promise<MermaidRuntime> | null = null;

async function loadMermaid(): Promise<MermaidRuntime> {
  if (mermaidPromise) return mermaidPromise;
  const attempt = import("mermaid").then((mod) => {
    const mermaid = mod.default;
    // `startOnLoad: false` — we drive rendering explicitly per node
    // instead of letting mermaid walk the document on DOMContentLoaded.
    // `securityLevel: "strict"` — mermaid sanitises its own labels and
    // will not execute user-authored HTML/JS in diagram text.
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
    return mermaid;
  });
  // Share the in-flight promise with parallel callers, but drop the
  // cache once it rejects so a transient failure (offline / stale
  // chunk after a deploy / ad-blocker hiccup) can be retried by the
  // next fence to render. Without this reset the module would be
  // dead until the user reloaded.
  attempt.catch(() => {
    if (mermaidPromise === attempt) mermaidPromise = null;
  });
  mermaidPromise = attempt;
  return attempt;
}

function placeLoadError(nodes: HTMLElement[], err: unknown, labels: MermaidRenderLabels): void {
  const message = labels.loadFailed(String(err));
  for (const node of nodes) {
    const errBox = document.createElement("pre");
    errBox.className = "mermaid-error";
    errBox.textContent = message;
    node.replaceWith(errBox);
  }
}

// Distinct per-diagram DOM id. Two diagrams on one page must not collide
// (mermaid uses the id as the SVG root id).
let renderCounter = 0;
function nextRenderId(idPrefix: string): string {
  renderCounter += 1;
  return `${idPrefix}-${renderCounter}`;
}

function pendingNodes(root: Element | Document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("pre.mermaid[data-mermaid-pending]"));
}

/** Adopt a mermaid-produced SVG string into a live DOM node via
 *  DOMParser (HTML5 mode) instead of assigning to `.innerHTML`.
 *  Mermaid's `securityLevel: "strict"` already escapes user-authored
 *  diagram text before building the SVG, so the string is trusted —
 *  but going through the parser satisfies opengrep's XSS heuristic
 *  that flags every raw `innerHTML =`. HTML5 mode (not `image/svg+xml`)
 *  is required: mermaid's SVG contains `<foreignObject>` wrappers with
 *  nested HTML content for labels (line-broken text via `<br>`, `<div>`,
 *  etc.), which is well-formed HTML5 but NOT well-formed XML — the
 *  XML parser drops a `<parsererror>` root and refuses. HTML5 mode
 *  treats `<svg>` as a foreign-namespace root and correctly parses
 *  the mixed subtree.
 *
 *  Exported for regression tests in
 *  `test/utils/markdown/test_mermaidRender.ts` so the assertion
 *  exercises the real production helper instead of an inline copy. */
export function adoptSvg(svgMarkup: string): SVGElement | null {
  const parsed = new DOMParser().parseFromString(svgMarkup, "text/html");
  // `<svg>` at the top level lands under `body` in HTML5 parsing.
  const svgEl = parsed.body.querySelector("svg");
  if (!svgEl) return null;
  return document.importNode(svgEl, true) as unknown as SVGElement;
}

async function renderOne(node: HTMLElement, mermaid: MermaidRuntime, labels: MermaidRenderLabels, idPrefix: string): Promise<void> {
  // `textContent` gives us the raw source — DOMPurify preserves it
  // verbatim inside `<pre>` and we escaped it going in, so entity
  // decoding is browser-native from the DOM read.
  const source = node.textContent ?? "";
  const svgId = nextRenderId(idPrefix);
  try {
    const { svg } = await mermaid.render(svgId, source);
    const svgNode = adoptSvg(svg);
    if (!svgNode) throw new Error("mermaid produced malformed SVG");
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-diagram";
    wrapper.appendChild(svgNode);
    node.replaceWith(wrapper);
  } catch (err) {
    // Preserve the source below the localised header so the author
    // can see WHICH diagram broke.
    const errBox = document.createElement("pre");
    errBox.className = "mermaid-error";
    errBox.textContent = `${labels.renderFailed(String(err))}\n---\n${source}`;
    node.replaceWith(errBox);
  }
}

/** Render every unprocessed mermaid placeholder under `root`. Safe to
 *  call repeatedly — nodes get replaced on success (no `data-*` to
 *  match a second time) and gain an `.mermaid-error` class on failure.
 *  Returns once every discovered node has been resolved. `labels`
 *  defaults to English fallbacks so the pure module remains callable
 *  from tests / node environments without an i18n runtime. */
export async function renderMermaidNodes(
  root: Element | Document | null | undefined,
  labels: MermaidRenderLabels = DEFAULT_LABELS,
  idPrefix = "mulmo-mermaid",
): Promise<void> {
  if (!root) return;
  const nodes = pendingNodes(root);
  if (nodes.length === 0) return;
  let mermaid: MermaidRuntime;
  try {
    mermaid = await loadMermaid();
  } catch (err) {
    // The dynamic import failed (network / bundler / adblock). Swap
    // every pending placeholder for a visible error box so the user
    // sees WHY the diagram is missing instead of a raw code fence, and
    // don't let the rejection escape as an unhandled promise (callers
    // fire this via `void run()` in the composable).
    placeLoadError(nodes, err, labels);
    return;
  }
  await Promise.all(nodes.map((node) => renderOne(node, mermaid, labels, idPrefix)));
}
