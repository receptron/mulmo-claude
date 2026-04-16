// Single source of truth for every tool name (= MCP tool / plugin key)
// the app knows about. Centralised here so:
//
//   - `Role.availablePlugins` can be typed as `ToolName[]` and typos
//     get caught at compile time instead of silently dropping a
//     plugin at runtime
//   - grep for "every place that handles this tool" returns a list
//     of `TOOL_NAMES.x` references rather than free-form strings
//   - adding a new plugin is a one-line change here + register in
//     `src/tools/index.ts` — and `typeof TOOL_NAMES` keeps both in
//     sync through the type system
//
// Naming is intentionally the literal string the server / MCP
// protocol / jsonl files expect — rename-touching requires a
// coordinated server + client update, which is exactly when having
// a central list here helps.
//
// First slice of issue #289 (item 4: tool name literals).

export const TOOL_NAMES = {
  // Text / base
  textResponse: "text-response",

  // Management plugins
  manageTodoList: "manageTodoList",
  manageScheduler: "manageScheduler",
  manageRoles: "manageRoles",
  manageSkills: "manageSkills",
  manageSource: "manageSource",
  manageWiki: "manageWiki",

  // Presentational plugins
  presentMulmoScript: "presentMulmoScript",
  presentDocument: "presentDocument",
  presentSpreadsheet: "presentSpreadsheet",
  presentHtml: "presentHtml",
  presentChart: "presentChart",
  presentForm: "presentForm",
  present3D: "present3D",

  // Creation / generation
  createMindMap: "createMindMap",
  generateImage: "generateImage",
  editImage: "editImage",
  openCanvas: "openCanvas",

  // Interactive / media
  putQuestions: "putQuestions",
  showMusic: "showMusic",
  piano: "piano",
  weather: "weather",

  // MCP tools (server-side, not GUI plugins — registered in
  // `server/mcp-tools/`). Listed here because they appear in a
  // role's `availablePlugins` alongside GUI plugins.
  readXPost: "readXPost",
  searchX: "searchX",

  // Built-in (handled specially by the MCP stdio bridge).
  switchRole: "switchRole",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/** Runtime predicate — useful when string input (URL param, JSON
 *  payload) needs to be narrowed to a known tool. */
export function isToolName(value: unknown): value is ToolName {
  if (typeof value !== "string") return false;
  return (Object.values(TOOL_NAMES) as readonly string[]).includes(value);
}

/** Array of all known tool names, in declaration order. */
export const ALL_TOOL_NAMES: readonly ToolName[] = Object.values(TOOL_NAMES);
