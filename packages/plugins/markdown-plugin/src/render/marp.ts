// Shared Marp render core (task #6 Phase 4). The one place both the
// MarpView preview AND each host's server-side PDF export construct a
// Marp instance, register workspace themes, apply custom-size bridging,
// and render — so the preview and the exported PDF can't drift, and a
// new host (MulmoTerminal) reuses it instead of re-deriving the config.
//
// Image handling stays with the CALLER: the browser preview rewrites
// `<img>` refs to host URLs before calling this; a server PDF passes raw
// markdown and inlines the resulting HTML's images to base64 after. This
// function only does the Marp config + render + slide-dimension readout.
//
// marp-core is dynamically imported so it stays out of the eager browser
// bundle (it's only needed once a Marp deck is actually rendered).

import { MARP_HTML_ALLOWLIST } from "@mulmoclaude/markdown-utils/markdown/marpTheme";
import { applyCustomMarpSize } from "@mulmoclaude/markdown-utils/markdown/marpCustomSize";
import type { MarpThemeEntry } from "../plugins/markdown/contract";

export const DEFAULT_SLIDE_WIDTH = 1280;
export const DEFAULT_SLIDE_HEIGHT = 720;
const MIN_SLIDE_DIM = 200;
const MAX_SLIDE_DIM = 3840;

function clampDim(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < MIN_SLIDE_DIM) return fallback;
  return Math.min(value, MAX_SLIDE_DIM);
}

// inlineSVG:false renders plain `div.marpit > section { width:Npx; height:Npx }`
// (CSS-driven sizing — the scrollable preview).
const SECTION_SIZE_RE = /div\.marpit\s*>\s*section\s*\{[^}]*?width:\s*(\d+)px[^}]*?height:\s*(\d+)px/;
function dimsFromCss(css: string): { width: number; height: number } {
  const match = css.match(SECTION_SIZE_RE);
  if (match) {
    return { width: clampDim(Number(match[1]), DEFAULT_SLIDE_WIDTH), height: clampDim(Number(match[2]), DEFAULT_SLIDE_HEIGHT) };
  }
  return { width: DEFAULT_SLIDE_WIDTH, height: DEFAULT_SLIDE_HEIGHT };
}

// inlineSVG:true wraps sections in an `<svg viewBox="0 0 W H">` (fixed
// coordinate system — one PDF page per slide at native proportions).
const VIEWBOX_RE = /viewBox="0 0 (\d+) (\d+)"/;
function dimsFromViewBox(html: string): { width: number; height: number } {
  const match = html.match(VIEWBOX_RE);
  if (!match) return { width: DEFAULT_SLIDE_WIDTH, height: DEFAULT_SLIDE_HEIGHT };
  return { width: clampDim(Number(match[1]), DEFAULT_SLIDE_WIDTH), height: clampDim(Number(match[2]), DEFAULT_SLIDE_HEIGHT) };
}

export interface RenderMarpOptions {
  /** Workspace Marp themes to register (decks opt in via `theme:`). */
  themes?: readonly MarpThemeEntry[];
  /** false (default) → CSS-sized `div.marpit > section` (scrollable
   *  preview); true → SVG `viewBox` sizing (fixed-page PDF export). The
   *  slide-dimension readout follows the mode. */
  inlineSVG?: boolean;
}

export interface RenderMarpResult {
  html: string;
  css: string;
  slideWidth: number;
  slideHeight: number;
}

/** Render a Marp deck. `markdown` must already have its images processed
 *  by the caller (preview: rewritten to URLs; PDF: left raw, inlined
 *  afterward). */
export async function renderMarpDeck(markdown: string, opts: RenderMarpOptions = {}): Promise<RenderMarpResult> {
  const inlineSVG = opts.inlineSVG ?? false;
  const { Marp } = await import("@marp-team/marp-core");
  // `html: MARP_HTML_ALLOWLIST` opens a small layout-tag subset; scripts,
  // iframes, form elements stay escaped. Same allowlist both modes so
  // preview / export agree on what raw HTML survives.
  const marp = new Marp({ inlineSVG, html: MARP_HTML_ALLOWLIST, emoji: { unicode: false, shortcode: false } });
  for (const theme of opts.themes ?? []) {
    marp.themeSet.add(theme.css);
  }
  const sized = applyCustomMarpSize(marp, markdown);
  const { html, css } = marp.render(sized);
  const { width, height } = inlineSVG ? dimsFromViewBox(html) : dimsFromCss(css);
  return { html, css, slideWidth: width, slideHeight: height };
}
