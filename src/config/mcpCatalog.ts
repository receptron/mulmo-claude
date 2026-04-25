// Curated catalog of pre-configured MCP servers (#823 Phase 1).
//
// Goal: a checkbox toggle in Settings → MCP tab that installs / removes
// a known-good server with sane defaults. The general user shouldn't
// have to read a README to wire up Memory or a calendar.
//
// **Phase 1 covers config-free entries only.** Per-server config
// schema (api keys, paths, etc.) lands in Phase 2. The shape below
// already carries `configSchema` so the data structure doesn't have
// to change between phases — only the UI grows.
//
// Selection criteria:
//   - 🟢 catalogue value > Claude Code built-in coverage
//     Built-ins (`Read` / `Write` / `Edit` / `WebFetch` / `WebSearch` /
//     `Bash`) already cover filesystem, fetch, and search; entries
//     duplicating those are out (#823 §"価値マトリクス").
//   - safe defaults: no auth required, or static config that won't
//     change per session.
//
// **community package names are best-effort** — Apple-native and
// screenshot MCPs vary by maintainer activity; PR reviewers should
// pin the exact package + version on merge.

import type { McpServerSpec } from "./mcpTypes";

export interface McpConfigField {
  /** Env var name (for stdio servers) or query/header key. */
  key: string;
  /** i18n key for the form label. */
  label: string;
  kind: "secret" | "text" | "path" | "url" | "select";
  placeholder?: string;
  required: boolean;
  /** Direct link to the provider's "how to get this" page. */
  helpUrl?: string;
  /** i18n key for inline help text under the field. */
  helpText?: string;
  /** For kind: "select" only. */
  options?: string[];
}

export interface McpCatalogEntry {
  /** Catalog id; also used as `McpServerEntry.id` when installed. */
  id: string;
  /** i18n key for the display name (e.g. "Memory"). */
  displayName: string;
  /** i18n key for a 1-sentence general-user description. */
  description: string;
  /** UI grouping. General is default-expanded; Developer is collapsed. */
  audience: "general" | "developer";
  /** 📦 npm package or GitHub repo — main project page. */
  upstreamUrl: string;
  /** 📚 provider's setup / onboarding guide (optional, often same as upstream). */
  setupGuideUrl?: string;
  /** Server spec template. `${VAR}` placeholders refer to configSchema keys. */
  spec: McpServerSpec;
  /** Per-entry form fields. Phase 1 entries are all empty. */
  configSchema: McpConfigField[];
  /** Coarse risk hint shown as a badge next to the entry name. */
  riskLevel: "low" | "medium" | "high";
}

// Phase 1 entries — all config-free.
//
// Implementation note for reviewers: the official `@modelcontextprotocol/*`
// packages are pinned by the upstream Anthropic team and stable. Apple-
// native and screenshot entries reference *placeholder* community
// packages — please verify the maintenance status (last commit, weekly
// downloads, open issues) before merge and replace if a healthier fork
// exists.
export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "memory",
    displayName: "settingsMcpTab.catalog.entry.memory.displayName",
    description: "settingsMcpTab.catalog.entry.memory.description",
    audience: "general",
    upstreamUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    },
    configSchema: [],
    riskLevel: "low",
  },
  {
    id: "sequential-thinking",
    displayName: "settingsMcpTab.catalog.entry.sequentialThinking.displayName",
    description: "settingsMcpTab.catalog.entry.sequentialThinking.description",
    audience: "general",
    upstreamUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    },
    configSchema: [],
    riskLevel: "low",
  },
  // Apple-native entries — macOS only at runtime. Surfaced on every
  // platform so the user understands why they exist; non-darwin hosts
  // get a server-side error on first use. Phase 2 adds an
  // `osConstraint: "darwin"` field so the UI can grey them out.
  {
    id: "apple-reminders",
    displayName: "settingsMcpTab.catalog.entry.appleReminders.displayName",
    description: "settingsMcpTab.catalog.entry.appleReminders.description",
    audience: "general",
    // TODO(reviewer): pin a maintained community package. As of
    // 2026-04, candidates include `mcp-server-apple-reminders` and
    // `apple-mcp` — pick the one with most recent activity.
    upstreamUrl: "https://github.com/modelcontextprotocol/servers#community-servers",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "mcp-server-apple-reminders"],
    },
    configSchema: [],
    riskLevel: "low",
  },
  {
    id: "apple-calendar",
    displayName: "settingsMcpTab.catalog.entry.appleCalendar.displayName",
    description: "settingsMcpTab.catalog.entry.appleCalendar.description",
    audience: "general",
    upstreamUrl: "https://github.com/modelcontextprotocol/servers#community-servers",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "mcp-server-apple-calendar"],
    },
    configSchema: [],
    riskLevel: "low",
  },
  {
    id: "apple-notes",
    displayName: "settingsMcpTab.catalog.entry.appleNotes.displayName",
    description: "settingsMcpTab.catalog.entry.appleNotes.description",
    audience: "general",
    upstreamUrl: "https://github.com/modelcontextprotocol/servers#community-servers",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "mcp-server-apple-notes"],
    },
    configSchema: [],
    riskLevel: "low",
  },
  {
    id: "apple-music",
    displayName: "settingsMcpTab.catalog.entry.appleMusic.displayName",
    description: "settingsMcpTab.catalog.entry.appleMusic.description",
    audience: "general",
    upstreamUrl: "https://github.com/modelcontextprotocol/servers#community-servers",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "mcp-server-apple-music"],
    },
    configSchema: [],
    riskLevel: "low",
  },
  {
    id: "screenshot",
    displayName: "settingsMcpTab.catalog.entry.screenshot.displayName",
    description: "settingsMcpTab.catalog.entry.screenshot.description",
    audience: "general",
    upstreamUrl: "https://github.com/modelcontextprotocol/servers#community-servers",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "mcp-screenshot"],
    },
    configSchema: [],
    riskLevel: "low",
  },
];

/** Look up by id. Returns null when the id isn't in the catalog
 *  (i.e. the server was added by hand via Custom servers). */
export function findCatalogEntry(entryId: string): McpCatalogEntry | null {
  return MCP_CATALOG.find((entry) => entry.id === entryId) ?? null;
}
