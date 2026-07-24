// Pure presentation mapping for the related-collections pulldown: a neighbor's
// navigation direction → the Material Icons glyph and the i18n label key shown
// next to it. Split out of the component so the direction→glyph/key contract is
// unit-testable and the composable stays a thin reactive shell.

import type { RelatedCollection } from "./relatedCollections";

type RelatedDirection = RelatedCollection["direction"];

/** Direction arrow glyph: `out` points away (this collection refs the neighbor),
 *  `in` points back (the neighbor refs this one), `both` is the two-way swap. */
export function relatedDirectionIcon(direction: RelatedDirection): string {
  if (direction === "out") return "arrow_outward";
  if (direction === "in") return "arrow_back";
  return "sync_alt";
}

/** i18n key for the direction's tooltip / aria-label. */
export function relatedDirectionLabelKey(direction: RelatedDirection): string {
  if (direction === "out") return "collectionsView.relatedOut";
  if (direction === "in") return "collectionsView.relatedIn";
  return "collectionsView.relatedBoth";
}
