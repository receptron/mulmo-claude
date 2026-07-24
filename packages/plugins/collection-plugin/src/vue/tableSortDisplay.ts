// Pure presentation mappings for the list-table sort header: given a column's
// current sort direction (and whether its button is hovered), what glyph /
// button colour / aria-sort token to render. Split out of the component so the
// hover-preview state machine and the a11y token are unit-testable.
//
// Deliberate asymmetry (pinned by tests): the ICON and the button COLOUR use the
// hover-preview direction (so hovering a descending column visibly fades toward
// the cleared "off" look, signalling the next click clears the sort), while the
// ARIA token reflects the column's ACTUAL direction — assistive tech must report
// the real state, never a hover preview.

import { nextSortDirection } from "@mulmoclaude/core/collection";

export type SortDir = "asc" | "desc" | null;

/** The direction to render visuals for: on hover, preview the next click's
 *  direction (none → asc → desc → none); otherwise the column's actual one. */
export function previewSortDir(current: SortDir, isHovered: boolean): SortDir {
  return isHovered ? nextSortDirection(current) : current;
}

/** Arrow glyph for a (preview) direction — descending points down, everything
 *  else (ascending or off) points up. */
export function sortIconNameForDir(dir: SortDir): string {
  return dir === "desc" ? "arrow_downward" : "arrow_upward";
}

/** Header-button colour: dark while a direction is active, light for the "off"
 *  state — so hovering a descending column previews the cleared look. */
export function sortButtonClassForDir(dir: SortDir): string {
  return dir ? "text-slate-600" : "text-slate-300";
}

/** `aria-sort` token for a column header cell. */
export function sortAriaTokenForDir(dir: SortDir): "ascending" | "descending" | "none" {
  if (dir === "asc") return "ascending";
  if (dir === "desc") return "descending";
  return "none";
}
