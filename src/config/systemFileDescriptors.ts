// System-managed file descriptors for the Files Explorer banner (#832).
//
// The Files Explorer right pane (FileContentRenderer.vue) shows a
// short description banner above the file body when the selected
// path matches one of these descriptors. Descriptors are i18n-keyed
// (the actual text lives under `systemFiles.<id>` in src/lang/) so
// all 8 locales stay in lockstep.

export type EditPolicy = "agent-managed-but-hand-editable" | "user-editable" | "agent-managed" | "fragile-format" | "ephemeral";

export interface SystemFileDescriptor {
  /** i18n key suffix → systemFiles.<id>.title / .summary */
  id: string;
  /** Repo-relative path to the schema source; rendered as a GitHub link when set. */
  schemaRef?: string;
  editPolicy: EditPolicy;
}

interface ExactEntry {
  kind: "exact";
  path: string;
  descriptor: SystemFileDescriptor;
}

interface PatternEntry {
  kind: "pattern";
  regex: RegExp;
  descriptor: SystemFileDescriptor;
}

type Entry = ExactEntry | PatternEntry;

// Exact matches are checked before patterns to keep precedence
// deterministic — e.g. `data/wiki/SCHEMA.md` should match the
// fragile-format descriptor, not get swallowed by a generic
// `data/wiki/*.md` pattern (which we currently don't have, but
// the ordering keeps that future option open).
export const SYSTEM_FILE_DESCRIPTORS: ReadonlyArray<Entry> = [
  // ── config/ ──
  {
    kind: "exact",
    path: "config/interests.json",
    descriptor: { id: "interests", schemaRef: "server/workspace/sources/interests.ts", editPolicy: "agent-managed-but-hand-editable" },
  },
  {
    kind: "exact",
    path: "config/mcp.json",
    descriptor: { id: "mcp", schemaRef: "server/system/config.ts", editPolicy: "user-editable" },
  },
  {
    kind: "exact",
    path: "config/settings.json",
    descriptor: { id: "settings", schemaRef: "server/system/config.ts", editPolicy: "user-editable" },
  },
  {
    kind: "exact",
    path: "config/scheduler/tasks.json",
    descriptor: { id: "schedulerTasks", schemaRef: "server/utils/files/user-tasks-io.ts", editPolicy: "agent-managed" },
  },
  {
    kind: "exact",
    path: "config/scheduler/overrides.json",
    descriptor: { id: "schedulerOverrides", schemaRef: "server/utils/files/scheduler-io.ts", editPolicy: "agent-managed" },
  },
  {
    kind: "exact",
    path: "config/news-read-state.json",
    descriptor: { id: "newsReadState", editPolicy: "ephemeral" },
  },
  // ── data/ ──
  {
    kind: "exact",
    path: "data/scheduler/items.json",
    descriptor: { id: "schedulerItems", schemaRef: "server/utils/files/scheduler-io.ts", editPolicy: "agent-managed" },
  },
  {
    kind: "exact",
    path: "data/todos/todos.json",
    descriptor: { id: "todosItems", schemaRef: "server/utils/files/todos-io.ts", editPolicy: "agent-managed-but-hand-editable" },
  },
  {
    kind: "exact",
    path: "data/todos/columns.json",
    descriptor: { id: "todosColumns", schemaRef: "server/utils/files/todos-io.ts", editPolicy: "user-editable" },
  },
  {
    kind: "exact",
    path: "data/wiki/index.md",
    descriptor: { id: "wikiIndex", editPolicy: "agent-managed" },
  },
  {
    kind: "exact",
    path: "data/wiki/log.md",
    descriptor: { id: "wikiLog", editPolicy: "agent-managed" },
  },
  {
    kind: "exact",
    path: "data/wiki/summary.md",
    descriptor: { id: "wikiSummary", editPolicy: "agent-managed" },
  },
  {
    kind: "exact",
    path: "data/wiki/SCHEMA.md",
    descriptor: { id: "wikiSchema", editPolicy: "fragile-format" },
  },
  // ── conversations/ ──
  {
    kind: "exact",
    path: "conversations/memory.md",
    descriptor: { id: "memory", schemaRef: "server/agent/prompt.ts", editPolicy: "agent-managed-but-hand-editable" },
  },
  {
    kind: "exact",
    path: "conversations/summaries/_index.md",
    descriptor: { id: "summariesIndex", editPolicy: "agent-managed" },
  },
  // ── patterns ──
  {
    kind: "pattern",
    regex: /^config\/roles\/[^/]+\.json$/,
    descriptor: { id: "rolesJson", schemaRef: "src/config/roles.ts", editPolicy: "user-editable" },
  },
  {
    kind: "pattern",
    regex: /^config\/roles\/[^/]+\.md$/,
    descriptor: { id: "rolesMd", schemaRef: "src/config/roles.ts", editPolicy: "user-editable" },
  },
  {
    kind: "pattern",
    regex: /^data\/sources\/[^_/][^/]*\.md$/,
    descriptor: { id: "sourceFeed", schemaRef: "server/workspace/sources/types.ts", editPolicy: "user-editable" },
  },
  {
    kind: "pattern",
    regex: /^data\/sources\/_state\/[^/]+\.json$/,
    descriptor: { id: "sourceState", editPolicy: "ephemeral" },
  },
  {
    kind: "pattern",
    regex: /^conversations\/summaries\/daily\/\d{4}\/\d{2}\/\d{2}\.md$/,
    descriptor: { id: "journalDaily", editPolicy: "agent-managed" },
  },
  {
    kind: "pattern",
    regex: /^conversations\/summaries\/topics\/[^/]+\.md$/,
    descriptor: { id: "journalTopic", editPolicy: "agent-managed" },
  },
];

export function descriptorForPath(filePath: string): SystemFileDescriptor | null {
  for (const entry of SYSTEM_FILE_DESCRIPTORS) {
    if (entry.kind === "exact" && entry.path === filePath) return entry.descriptor;
    if (entry.kind === "pattern" && entry.regex.test(filePath)) return entry.descriptor;
  }
  return null;
}

// Tailwind text colors used to tint a file-icon (or any single-color
// glyph) according to the system file's edit policy. Same hue as the
// banner's chip but text-only (no background) — the chip uses a
// bg + text combo for emphasis; the icon only needs the foreground.
// Kept here next to the EditPolicy type so adding a policy can't
// drift past one without the other.
export const EDIT_POLICY_ICON_COLOR: Record<EditPolicy, string> = {
  "agent-managed-but-hand-editable": "text-emerald-500",
  "user-editable": "text-blue-500",
  "agent-managed": "text-amber-500",
  "fragile-format": "text-orange-500",
  ephemeral: "text-gray-400",
};
