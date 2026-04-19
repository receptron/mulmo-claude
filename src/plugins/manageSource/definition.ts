import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "manageSource";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description:
    "Manage the user's information-source registry stored under <workspace>/sources/. Use this for RSS feeds, GitHub repos (releases or issues), and arXiv search queries. After every action the response carries the full registry so the UI can re-render. Always call action='list' to display the current registry in the canvas.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "register", "remove", "rebuild"],
        description:
          "What to do. 'list' = show the registry. 'register' = add a new source (requires title + url + fetcherKind, fetcherParams). 'remove' = delete by slug. 'rebuild' = run the daily aggregation pipeline now.",
      },
      slug: {
        type: "string",
        description:
          "Source slug (lowercase letters/digits/hyphens). Required for action='remove'. Optional for action='register' (auto-derived from title when omitted).",
      },
      title: {
        type: "string",
        description:
          "Human-friendly source name. Required for action='register'.",
      },
      url: {
        type: "string",
        description:
          "Canonical URL: feed URL for RSS, repo URL (https://github.com/<owner>/<name>) for github-*, or the arXiv search/listing URL for arxiv. Required for action='register'.",
      },
      fetcherKind: {
        type: "string",
        enum: ["rss", "github-releases", "github-issues", "arxiv"],
        description:
          "Which fetcher handles this source. Infer from the URL when registering: feed URLs → 'rss'; github.com/<owner>/<name> → 'github-releases' or 'github-issues' depending on user intent; arxiv.org → 'arxiv'.",
      },
      fetcherParams: {
        type: "object",
        description:
          "Fetcher-specific params (flat object of string values). For 'rss' set { rss_url: '<feed URL>' }. For 'github-releases' / 'github-issues' set { github_repo: 'owner/name' }. For 'arxiv' set { arxiv_query: '<query, e.g. cat:cs.CL>' }.",
      },
      schedule: {
        type: "string",
        enum: ["daily", "weekly", "manual"],
        description:
          "How often the pipeline should fetch this source. Default 'daily'.",
      },
      categories: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional category override. When omitted the auto-classifier picks from the 25-slug taxonomy.",
      },
      notes: {
        type: "string",
        description: "Free-form notes shown in the UI.",
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
