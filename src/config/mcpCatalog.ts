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
//   - **only verified, pinned packages.** Apple-native + screenshot
//     entries explored during design have no ecosystem-stable
//     package today (community impls vary by maintainer activity);
//     they are intentionally NOT shipped in Phase 1. Add them in
//     a follow-up PR once a maintained package is selected and
//     pinned by version.

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

// Phase 1 entries — all config-free, all pinned to verified upstream
// packages maintained by the official `@modelcontextprotocol` team.
// The Apple-native and screenshot entries explored during the #823
// design discussion are deliberately NOT shipped here: no community
// package was stable enough to pin (last-commit / downloads / open-
// issues all uncertain). They land in a follow-up once a maintained
// package is selected.
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
];

/** Look up by id. Returns null when the id isn't in the catalog
 *  (i.e. the server was added by hand via Custom servers). */
export function findCatalogEntry(entryId: string): McpCatalogEntry | null {
  return MCP_CATALOG.find((entry) => entry.id === entryId) ?? null;
}
