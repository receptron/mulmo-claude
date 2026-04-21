// Pure helpers for todo labels. Used by both the server route
// (server/routes/todos.ts) and the Vue views (View.vue / Preview.vue),
// so the file is kept free of Node-only and browser-only APIs.
//
// Storage contract:
//   - Labels are case-preserving strings (e.g. "Work", "Groceries")
//   - Matching / deduplication is case-insensitive
//   - Whitespace is trimmed and collapsed on normalise
//   - Empty / whitespace-only labels are rejected

// ── Normalisation and comparison ──────────────────────────────────

// Trim leading/trailing whitespace and collapse internal whitespace
// runs to single spaces. Returns `null` for empty / whitespace-only
// input so callers can filter out bad entries at the boundary.
export function normalizeLabel(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}

// Case-insensitive label equality. Both inputs are normalised first
// so `" Work "` and `"work"` compare equal.
export function labelsEqual(left: string, right: string): boolean {
  const normLeft = normalizeLabel(left);
  const normRight = normalizeLabel(right);
  if (normLeft === null || normRight === null) return false;
  return normLeft.toLowerCase() === normRight.toLowerCase();
}

// ── Colour assignment ─────────────────────────────────────────────

// Eight Tailwind pastel chip styles. Enough visual variety without
// turning the UI into a rainbow. Every label maps deterministically
// to one of these via `colorForLabel`.
export const LABEL_PALETTE: readonly string[] = [
  "bg-blue-100 text-blue-700",
  "bg-green-100 text-green-700",
  "bg-purple-100 text-purple-700",
  "bg-yellow-100 text-yellow-700",
  "bg-pink-100 text-pink-700",
  "bg-indigo-100 text-indigo-700",
  "bg-red-100 text-red-700",
  "bg-teal-100 text-teal-700",
] as const;

// Deterministic colour class for a label. Same label → same colour
// across sessions and across clients. Case-insensitive so that
// `"Work"` and `"work"` look identical even if they drift in
// different items over time.
export function colorForLabel(label: string): string {
  const key = label.toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    // Classic 31-multiplier string hash. Kept as unsigned via >>> 0
    // so the modulo at the end doesn't produce negatives.
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return LABEL_PALETTE[hash % LABEL_PALETTE.length];
}

// ── Filtering ─────────────────────────────────────────────────────

// OR-semantics filter: return items that have at least one label in
// `filterLabels`. Matching is case-insensitive. An empty filter list
// is a pass-through — callers don't need to special-case "no filter"
// themselves.
//
// Items whose `labels` is `undefined` or `[]` are excluded when
// `filterLabels` is non-empty, since they have nothing to match.
export function filterByLabels<T extends { labels?: string[] }>(items: readonly T[], filterLabels: readonly string[]): T[] {
  if (filterLabels.length === 0) return [...items];
  const wanted = new Set(
    filterLabels
      .map(normalizeLabel)
      .filter((label): label is string => label !== null)
      .map((label) => label.toLowerCase()),
  );
  if (wanted.size === 0) return [...items];
  return items.filter((item) => {
    const itemLabels = item.labels ?? [];
    return itemLabels.some((label) => {
      const normalized = normalizeLabel(label);
      return normalized !== null && wanted.has(normalized.toLowerCase());
    });
  });
}

// ── Label inventory ──────────────────────────────────────────────

// Distinct-label summary for the whole collection. Counts are
// case-insensitive: `"Work"` and `"work"` merge into one row. The
// displayed form is the first spelling encountered while scanning,
// which is usually the most recently added item at the top of the
// list — stable enough in practice and avoids a second full pass.
//
// Sorted by count desc, then by the displayed label asc (case-
// insensitive) for deterministic output.
export function listLabelsWithCount(items: readonly { labels?: string[] }[]): Array<{ label: string; count: number }> {
  const groups = new Map<string, { label: string; count: number }>();
  for (const item of items) {
    const seenInItem = new Set<string>();
    for (const raw of item.labels ?? []) {
      const normalized = normalizeLabel(raw);
      if (normalized === null) continue;
      const key = normalized.toLowerCase();
      // Guard against the same label appearing twice within one item
      // (shouldn't happen post-mergeLabels but be safe).
      if (seenInItem.has(key)) continue;
      seenInItem.add(key);
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
      } else {
        groups.set(key, { label: normalized, count: 1 });
      }
    }
  }
  return [...groups.values()].sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return left.label.toLowerCase() < right.label.toLowerCase() ? -1 : left.label.toLowerCase() > right.label.toLowerCase() ? 1 : 0;
  });
}

// ── Set operations (for add_label / remove_label) ────────────────

// Union of `existing` and `adding`, de-duped case-insensitively.
// Preserves the order of `existing`, then appends newly-introduced
// labels in the order they appear in `adding`. Normalises both
// sides (trim/collapse) before comparison and storage.
export function mergeLabels(existing: readonly string[], adding: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const push = (label: string): void => {
    const normalized = normalizeLabel(label);
    if (normalized === null) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  };
  for (const label of existing) push(label);
  for (const label of adding) push(label);
  return result;
}

// Remove `removing` labels from `existing`, case-insensitively.
// Removing a label that isn't present is a no-op. The order of
// surviving labels is preserved. Normalises both sides first.
export function subtractLabels(existing: readonly string[], removing: readonly string[]): string[] {
  const toRemove = new Set(
    removing
      .map(normalizeLabel)
      .filter((label): label is string => label !== null)
      .map((label) => label.toLowerCase()),
  );
  if (toRemove.size === 0) {
    return existing.map(normalizeLabel).filter((label): label is string => label !== null);
  }
  return existing
    .map(normalizeLabel)
    .filter((label): label is string => label !== null)
    .filter((label) => !toRemove.has(label.toLowerCase()));
}
