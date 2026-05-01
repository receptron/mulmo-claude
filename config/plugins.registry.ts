// Single source of truth for the GUI plugin → API-endpoint mapping.
// Used by `scripts/generate-plugin-registry.mjs` to generate
// `server/agent/plugin-names.ts` deterministically.
//
// Phase 1a of #1043: today this only drives the server-side
// `plugin-names.ts`. Phase 1b will extend the same manifest to
// generate `src/tools/index.ts` and `src/config/toolNames.ts`
// (those have view-only / legacy / built-in special cases that need
// extra fields here, kept out of Phase 1a to keep this PR mechanical).
//
// **How to register a new plugin (after this PR):**
//   1. Add a row to PLUGIN_REGISTRY below.
//   2. Run `yarn generate:plugins`.
//   3. Commit the regenerated file.
// CI runs the same `generate:plugins` and asserts no diff so a
// manifest edit without a regenerated file trips CI.

/** One plugin's row in the registry. The id must match the literal
 *  tool name string the LLM and JSONL files use. The endpoint is a
 *  dotted path into `API_ROUTES`; the codegen looks it up at gen
 *  time and emits the bracket-access expression. The import shape
 *  reflects the package's public surface — internal plugins
 *  default-export their definition; external packages and a few
 *  internal plugins (presentForm) export TOOL_DEFINITION named. */
export interface PluginRegistration {
  /** Tool name the LLM uses. Matches the existing string literal
   *  in `TOOL_NAMES` in `src/config/toolNames.ts`. */
  id: string;
  /** Dotted path into `API_ROUTES`. e.g. `"todos.dispatch"` →
   *  `API_ROUTES.todos.dispatch`. The codegen emits the bracket
   *  access verbatim — typos surface as a TypeScript error in
   *  the generated file. */
  endpointKey: string;
  /** Module specifier. For internal plugins this is the relative
   *  path from `server/agent/plugin-names.ts` MINUS the trailing
   *  `.js` (the generator appends `.js` so node ESM resolution
   *  works at runtime). For external plugins it's the package
   *  specifier (`@gui-chat-plugin/mindmap`). */
  importFrom: string;
  /** Whether the source module default-exports the definition or
   *  exposes it as a named `TOOL_DEFINITION` export. Internal
   *  plugins are mostly `default`; external packages and
   *  `presentForm` use `named`. */
  importStyle: "default" | "named";
}

export const PLUGIN_REGISTRY: readonly PluginRegistration[] = [
  // Internal plugins (default export of definition.ts)
  { id: "manageTodoList", endpointKey: "todos.dispatch", importFrom: "../../src/plugins/todo/definition", importStyle: "default" },
  // Accounting plugin: opt-in only (see plans/feat-accounting.md).
  // Registering it here is required for the MCP bridge to route
  // tool calls — the gating happens at the Role level, not at
  // registry level.
  { id: "manageAccounting", endpointKey: "accounting.dispatch", importFrom: "../../src/plugins/accounting/definition", importStyle: "default" },
  { id: "manageCalendar", endpointKey: "scheduler.base", importFrom: "../../src/plugins/scheduler/calendarDefinition", importStyle: "default" },
  { id: "manageAutomations", endpointKey: "scheduler.base", importFrom: "../../src/plugins/scheduler/automationsDefinition", importStyle: "default" },
  { id: "presentMulmoScript", endpointKey: "mulmoScript.save", importFrom: "../../src/plugins/presentMulmoScript/definition", importStyle: "default" },
  { id: "manageSkills", endpointKey: "skills.create", importFrom: "../../src/plugins/manageSkills/definition", importStyle: "default" },
  { id: "manageSource", endpointKey: "sources.manage", importFrom: "../../src/plugins/manageSource/definition", importStyle: "default" },
  { id: "presentHtml", endpointKey: "html.present", importFrom: "../../src/plugins/presentHtml/definition", importStyle: "default" },
  { id: "presentChart", endpointKey: "chart.present", importFrom: "../../src/plugins/chart/definition", importStyle: "default" },
  { id: "presentDocument", endpointKey: "plugins.presentDocument", importFrom: "../../src/plugins/markdown/definition", importStyle: "default" },
  { id: "presentSpreadsheet", endpointKey: "plugins.presentSpreadsheet", importFrom: "../../src/plugins/spreadsheet/definition", importStyle: "default" },
  { id: "generateImage", endpointKey: "image.generate", importFrom: "../../src/plugins/generateImage/definition", importStyle: "default" },
  { id: "openCanvas", endpointKey: "plugins.canvas", importFrom: "../../src/plugins/canvas/definition", importStyle: "default" },
  { id: "editImages", endpointKey: "image.edit", importFrom: "../../src/plugins/editImages/definition", importStyle: "default" },

  // Internal plugin using TOOL_DEFINITION named export
  { id: "presentForm", endpointKey: "plugins.form", importFrom: "../../src/plugins/presentForm/definition", importStyle: "named" },

  // External npm packages (always TOOL_DEFINITION named export)
  { id: "createMindMap", endpointKey: "plugins.mindmap", importFrom: "@gui-chat-plugin/mindmap", importStyle: "named" },
  { id: "putQuestions", endpointKey: "plugins.quiz", importFrom: "@mulmochat-plugin/quiz", importStyle: "named" },
  { id: "present3D", endpointKey: "plugins.present3d", importFrom: "@gui-chat-plugin/present3d", importStyle: "named" },
];
