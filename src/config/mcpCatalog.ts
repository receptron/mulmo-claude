// Curated catalog of pre-configured MCP servers (#823 Phases 1+2).
//
// Goal: a checkbox toggle in Settings → MCP tab that installs / removes
// a known-good server with sane defaults. The general user shouldn't
// have to read a README to wire up Memory or a calendar.
//
// Phase 1 (#825) shipped 2 config-free entries (Memory / Sequential
// Thinking) — Apple-native / Screenshot were explored but dropped
// at merge because no community package was stable enough to pin.
// Phase 2 adds 6 more in the docs / info-gathering / general-task
// buckets and wires up the per-server config form (api keys, paths,
// etc.) — fields described by `configSchema` are interpolated into
// the spec template at install time via `interpolateMcpSpec`.
//
// Selection criteria:
//   - 🟢 catalogue value > Claude Code built-in coverage
//     Built-ins (`Read` / `Write` / `Edit` / `WebFetch` / `WebSearch` /
//     `Bash`) already cover filesystem, fetch, and search; entries
//     duplicating those are out (#823 §"価値マトリクス").
//   - safe defaults: no auth required, or one-time API key the user
//     can paste during install.
//
// **community package names are best-effort** — Slack, Google Maps,
// and Open-Meteo MCPs vary by maintainer activity; PR reviewers
// should pin the exact package + version on merge after checking
// weekly downloads / last commit.

import type { McpServerSpec } from "./mcpTypes";

export interface McpConfigField {
  /** Env var name (stdio) or placeholder name referenced as `${KEY}` in
   *  the spec template (works for url / headers on http too). */
  key: string;
  /** i18n key for the form label above the input. */
  label: string;
  kind: "secret" | "text" | "path" | "url" | "select";
  /** Raw placeholder text shown inside the input. Technical hints like
   *  `sk-…` or `xoxb-…` aren't localised; use `helpText` for prose. */
  placeholder?: string;
  required: boolean;
  /** Direct link to the provider's "how to get this" page. Rendered
   *  next to the label as a 🔑 affordance. */
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

// Phase 1 ships the two upstream-pinned entries; Phase 2 adds six
// more with `configSchema` form-driven setup. The official
// `@modelcontextprotocol/*` packages are pinned by the upstream
// Anthropic team; community packages added in Phase 2 should be
// re-verified at every release.
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
  // Apple-native + screenshot entries explored during the #823
  // design were intentionally dropped from Phase 1 (#825) because no
  // community package was stable enough to pin. They land in a
  // follow-up once a maintained package is selected.

  // ── Phase 2 entries (#823) ────────────────────────────────────

  // Library docs lookup. Up-to-date docs for popular libraries
  // fetched at runtime — beats the model's training-cutoff
  // memory for fast-moving frameworks.
  {
    id: "context7",
    displayName: "settingsMcpTab.catalog.entry.context7.displayName",
    description: "settingsMcpTab.catalog.entry.context7.description",
    audience: "general",
    upstreamUrl: "https://github.com/upstash/context7",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    },
    configSchema: [],
    riskLevel: "low",
  },

  // GitHub repo wiki lookup over HTTP. Hosted by Cognition;
  // no install / no auth — the model can ask "what is X repo
  // about" and get a structured summary.
  {
    id: "deepwiki",
    displayName: "settingsMcpTab.catalog.entry.deepwiki.displayName",
    description: "settingsMcpTab.catalog.entry.deepwiki.description",
    audience: "general",
    upstreamUrl: "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
    spec: {
      type: "http",
      url: "https://mcp.deepwiki.com/sse",
    },
    configSchema: [],
    riskLevel: "low",
  },

  // Notion workspace access. Official Notion MCP server uses an
  // OPENAPI_MCP_HEADERS env var that wraps the bearer token in
  // JSON; the user only fills the bare API key and we build the
  // header here. See https://github.com/makenotion/notion-mcp-server.
  {
    id: "notion",
    displayName: "settingsMcpTab.catalog.entry.notion.displayName",
    description: "settingsMcpTab.catalog.entry.notion.description",
    audience: "general",
    upstreamUrl: "https://github.com/makenotion/notion-mcp-server",
    setupGuideUrl: "https://www.notion.so/help/create-integrations-with-the-notion-api",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: {
        OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer ${NOTION_API_KEY}","Notion-Version":"2022-06-28"}',
      },
    },
    configSchema: [
      {
        key: "NOTION_API_KEY",
        label: "settingsMcpTab.catalog.entry.notion.field.apiKey.label",
        kind: "secret",
        placeholder: "secret_...",
        required: true,
        helpUrl: "https://www.notion.so/my-integrations",
        helpText: "settingsMcpTab.catalog.entry.notion.field.apiKey.help",
      },
    ],
    riskLevel: "medium",
  },

  // Slack channel + message access. TODO(reviewer): the official
  // @modelcontextprotocol/server-slack package is archived but still
  // resolves on npm; check community forks (e.g. mcp-server-slack)
  // for active maintenance before merge.
  {
    id: "slack",
    displayName: "settingsMcpTab.catalog.entry.slack.displayName",
    description: "settingsMcpTab.catalog.entry.slack.description",
    audience: "general",
    upstreamUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    setupGuideUrl: "https://api.slack.com/quickstart",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: {
        SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}",
        SLACK_TEAM_ID: "${SLACK_TEAM_ID}",
      },
    },
    configSchema: [
      {
        key: "SLACK_BOT_TOKEN",
        label: "settingsMcpTab.catalog.entry.slack.field.botToken.label",
        kind: "secret",
        placeholder: "xoxb-...",
        required: true,
        helpUrl: "https://api.slack.com/apps",
        helpText: "settingsMcpTab.catalog.entry.slack.field.botToken.help",
      },
      {
        key: "SLACK_TEAM_ID",
        label: "settingsMcpTab.catalog.entry.slack.field.teamId.label",
        kind: "text",
        placeholder: "T01ABC23DEF",
        required: true,
        helpUrl: "https://api.slack.com/methods/team.info",
        helpText: "settingsMcpTab.catalog.entry.slack.field.teamId.help",
      },
    ],
    riskLevel: "medium",
  },

  // Google Maps — places search + directions. TODO(reviewer):
  // @modelcontextprotocol/server-google-maps is also archived;
  // verify a maintained alternative if a healthier package exists.
  {
    id: "google-maps",
    displayName: "settingsMcpTab.catalog.entry.googleMaps.displayName",
    description: "settingsMcpTab.catalog.entry.googleMaps.description",
    audience: "general",
    upstreamUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps",
    setupGuideUrl: "https://developers.google.com/maps/documentation/javascript/get-api-key",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-google-maps"],
      env: {
        GOOGLE_MAPS_API_KEY: "${GOOGLE_MAPS_API_KEY}",
      },
    },
    configSchema: [
      {
        key: "GOOGLE_MAPS_API_KEY",
        label: "settingsMcpTab.catalog.entry.googleMaps.field.apiKey.label",
        kind: "secret",
        placeholder: "AIza...",
        required: true,
        helpUrl: "https://console.cloud.google.com/google/maps-apis/credentials",
        helpText: "settingsMcpTab.catalog.entry.googleMaps.field.apiKey.help",
      },
    ],
    riskLevel: "low",
  },

  // Weather forecast / current conditions via Open-Meteo. Open-Meteo
  // is keyless for non-commercial use, so this entry is config-free.
  // TODO(reviewer): pick the most-active community package — as of
  // 2026-04 candidates include `mcp-server-open-meteo` and
  // `@cloud-rocket/mcp-server-open-meteo`.
  {
    id: "weather-open-meteo",
    displayName: "settingsMcpTab.catalog.entry.weatherOpenMeteo.displayName",
    description: "settingsMcpTab.catalog.entry.weatherOpenMeteo.description",
    audience: "general",
    upstreamUrl: "https://open-meteo.com/",
    spec: {
      type: "stdio",
      command: "npx",
      args: ["-y", "mcp-server-open-meteo"],
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

/** Set of `${KEY}` names the spec template requires the user to fill. */
export function requiredKeysOf(entry: McpCatalogEntry): Set<string> {
  return new Set(entry.configSchema.filter((field) => field.required).map((field) => field.key));
}
