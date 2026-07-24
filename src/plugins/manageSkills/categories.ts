// Pure helpers behind the /skills page sidebar. Lifted out of View.vue
// so the section-collapse state and the provenance rule (mc- prefix
// split, user/project source mapping) live in exactly one place and can
// be unit-tested in node:test without a DOM or a Vue runtime.

import type { SkillSummary } from "./index";

// categorizeSkill / pickInitialSelection only care about name + source,
// not description. Exposing a narrower input type lets unit tests build
// fixtures without padding placeholder descriptions everywhere.
export type SkillIdentity = Pick<SkillSummary, "name" | "source">;

// `mc-` is the launcher-managed namespace (see
// server/workspace/skills-preset.ts). Skills under this prefix ship
// with mulmoclaude and are overwritten on every boot, so the UI treats
// them as the read-only "system" provenance and gates editing
// accordingly. This is NOT the sidebar grouping axis — provenance only
// drives the per-row badge tooltip and the edit/delete gate. The
// sidebar groups by section (active vs catalog), see SKILL_SECTION_KEYS.
export const SYSTEM_SKILL_PREFIX = "mc-";
export type SkillProvenance = "system" | "project" | "user";

/** Map a skill to its provenance bucket (badge + edit-gate, not layout). */
export function categorizeSkill(skill: SkillIdentity): SkillProvenance {
  if (skill.source === "user") return "user";
  if (skill.name.startsWith(SYSTEM_SKILL_PREFIX)) return "system";
  return "project";
}

// Sidebar collapsible sections, aligned with the #1335 catalog/active
// model: "active" = skills in `.claude/skills/` (discovered by Claude
// Code, loaded into the system prompt); "catalog" = launcher-managed
// presets the user can browse / ★ star / ▶ run once without bloating
// the prompt. Provenance (system/project/user) is shown as a per-row
// badge inside the Active section, not as its own collapsible group.
export const SKILL_SECTION_KEYS = ["active", "catalog"] as const;
export type SkillSectionKey = (typeof SKILL_SECTION_KEYS)[number];

export const SECTION_LABEL_KEYS: Record<SkillSectionKey, string> = {
  active: "pluginManageSkills.sectionActive",
  catalog: "pluginManageSkills.sectionCatalog",
};

// Both sections open by default — #1335 shows Active and Catalog
// expanded; the user collapses whichever they don't want to see.
export const DEFAULT_CLOSED_SECTIONS: readonly SkillSectionKey[] = [];
export const COLLAPSED_SECTIONS_STORAGE_KEY = "skills:sectionCollapsed";

/**
 * @internal exported only so the unit tests can target the type guard
 * directly. Call sites should reach it via loadCollapsedSections.
 */
export function isSkillSectionKey(value: unknown): value is SkillSectionKey {
  return typeof value === "string" && (SKILL_SECTION_KEYS as readonly string[]).includes(value);
}

/** Read the persisted collapse state, falling back to defaults on any error. */
export function loadCollapsedSections(): Set<SkillSectionKey> {
  const defaults = new Set<SkillSectionKey>(DEFAULT_CLOSED_SECTIONS);
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY);
    if (raw === null) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    return new Set<SkillSectionKey>(parsed.filter(isSkillSectionKey));
  } catch {
    return defaults;
  }
}

/** Persist the collapse state. Failures (e.g. localStorage disabled) are swallowed. */
export function persistCollapsedSections(state: ReadonlySet<SkillSectionKey>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify([...state]));
  } catch {
    // localStorage may be unavailable (private mode) — swallow silently.
  }
}

/**
 * Toggle a key's membership in a set, returning a fresh set (the input
 * is never mutated). Both sidebar collapse handlers — section-level and
 * per-repo — clone the set, add-or-delete the key, then replace it
 * wholesale so Vue sees a new reference; this centralises the add-or-
 * delete so the two call sites can't drift.
 */
export function toggleInSet<T>(set: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

// Per-external-repo collapse state (#1383 PR-C2). Distinct storage key
// from the section-level state above: the section axis is a fixed
// 2-value union (active/catalog), whereas repo ids are open-ended
// (one per installed external repo), so this set is validated as
// plain strings rather than against a key union. Default: every repo
// EXPANDED (absent = open) — a freshly installed repo should show its
// skills without a click.
export const REPO_COLLAPSED_STORAGE_KEY = "skills:repoCollapsed";

/** Read the persisted per-repo collapse set, defaulting to empty
 *  (all repos expanded) on any error. */
export function loadRepoCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(REPO_COLLAPSED_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

/** Persist the per-repo collapse set. Failures are swallowed. */
export function persistRepoCollapsed(state: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REPO_COLLAPSED_STORAGE_KEY, JSON.stringify([...state]));
  } catch {
    // localStorage may be unavailable (private mode) — swallow silently.
  }
}

/**
 * Auto-select the first active skill so the right pane isn't empty on
 * open. Returns null when the Active section is collapsed (don't select
 * a row the user can't see) or when there are no active skills.
 */
export function pickInitialSelection(skillList: readonly SkillIdentity[], collapsed: ReadonlySet<SkillSectionKey>): string | null {
  if (skillList.length === 0) return null;
  if (collapsed.has("active")) return null;
  return skillList[0].name;
}

// Catalog provenance for a browsable entry (#1335 preset / #1383
// external). Distinct from SkillProvenance above — that classifies an
// ACTIVE skill by badge; this classifies a CATALOG row by how it is
// addressed.
export type CatalogSource = "preset" | "external";

// Minimal shape entryKey / catalogActionParams read. Exposing a narrow
// input (mirrors SkillIdentity above) lets unit tests build fixtures
// without the name / description / alreadyActive padding the full
// CatalogEntry carries.
export interface CatalogEntryIdentity {
  slug: string;
  source: CatalogSource;
  repoId?: string;
  skillFolder?: string;
}

/**
 * Stable UI identity for a catalog row — the value that flows into the
 * Vue `:key`, the `skill-catalog-item-<key>` testid, the highlight
 * comparison, and the in-flight action lock.
 *
 * External `slug` is the backend-derived `<owner>-<skillFolder>`
 * activeId: lossy and owner-prefixed, so two external entries from the
 * same owner can collide on slug alone (duplicate Vue keys / testids,
 * wrong row highlighted, a shared in-flight lock, and a stale-response
 * guard passing for the wrong item). `(repoId, skillFolder)` is the
 * unique stable key; presets keep their already-unique slug.
 */
export function entryKey(entry: CatalogEntryIdentity): string {
  if (entry.source === "external" && entry.repoId && entry.skillFolder) {
    return `${entry.repoId}/${entry.skillFolder}`;
  }
  return entry.slug;
}

/**
 * Body / query shape for the star + preview endpoints: external entries
 * are addressed by `(repoId, skillFolder)`, presets by slug. Centralised
 * so the two call sites (star, preview) can't drift.
 */
export function catalogActionParams(entry: CatalogEntryIdentity): Record<string, string> {
  if (entry.source === "external" && entry.repoId && entry.skillFolder) {
    return { source: "external", repoId: entry.repoId, skillFolder: entry.skillFolder };
  }
  return { source: entry.source, slug: entry.slug };
}

/**
 * Request body for the external-repo install endpoint: the URL plus an
 * optional (trimmed, non-empty) subpath. Centralised so the two callers —
 * a fresh install and a repo "update" (re-install with the recorded
 * url/subpath) — send an identical shape and can't drift.
 */
export function buildRepoInstallBody(url: string, subpath?: string): Record<string, string> {
  const body: Record<string, string> = { url };
  const trimmed = subpath?.trim();
  if (trimmed) body.subpath = trimmed;
  return body;
}

/**
 * Group external catalog entries under their repo, preserving the given
 * repo order. A repo with zero discoverable entries still yields a group
 * (empty `entries`) so an install that found nothing stays visible
 * rather than silently absent. Entries within a repo are sorted by slug.
 * Generic over the concrete entry / repo shapes so callers keep their
 * full types.
 */
export function groupEntriesByRepo<Entry extends { repoId?: string; slug: string }, Repo extends { repoId: string }>(
  entries: readonly Entry[],
  repos: readonly Repo[],
): { repo: Repo; entries: Entry[] }[] {
  return repos.map((repo) => ({
    repo,
    entries: entries.filter((entry) => entry.repoId === repo.repoId).sort((left, right) => left.slug.localeCompare(right.slug)),
  }));
}

/** `https://github.com/owner/repo` → `owner/repo`; falls back to the
 *  repoId when the URL is unparseable. */
export function repoLabel(repo: { url: string; repoId: string }): string {
  const match = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(repo.url);
  return match ? match[1] : repo.repoId;
}

// Provenance badge for a sidebar row: icon + colour + the i18n title
// KEY (not the resolved string) so this stays pure and testable — the
// view resolves the key through vue-i18n. Derived via categorizeSkill so
// the badge tracks sectionLegend and the edit gate.
export interface SkillBadgeMeta {
  icon: string;
  colour: string;
  titleKey: string;
}

export function skillBadgeMeta(skill: SkillIdentity): SkillBadgeMeta {
  const provenance = categorizeSkill(skill);
  if (provenance === "system") {
    return { icon: "lock", colour: "text-gray-500", titleKey: "pluginManageSkills.sourceSystemTitle" };
  }
  if (provenance === "user") {
    return { icon: "home", colour: "text-blue-500", titleKey: "pluginManageSkills.sourceUserTitle" };
  }
  return { icon: "folder", colour: "text-green-600", titleKey: "pluginManageSkills.sourceProjectTitle" };
}

// Resolved provenance badge the template consumes: the i18n title is
// already resolved to a string, unlike the pure SkillBadgeMeta which
// carries the unresolved titleKey. Shared so View.vue and the extracted
// panes agree on the badge prop shape.
export interface SourceMeta {
  icon: string;
  title: string;
  colour: string;
}

// Catalog preset rows share one provenance badge (the launcher-managed
// "library" glyph). Static — the view resolves titleKey through vue-i18n.
export const PRESET_SOURCE_META: SkillBadgeMeta = {
  icon: "inventory_2",
  colour: "text-gray-400",
  titleKey: "pluginManageSkills.sourcePresetTitle",
};
