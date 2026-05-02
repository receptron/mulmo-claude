import type { PluginEntry } from "./types";
import { LEGACY_VIEW_ONLY_PLUGIN_NAMES } from "./legacyPluginNames";
import { getRuntimePluginEntry, getRuntimeToolNames } from "./runtimeLoader";
import textResponsePlugin from "../plugins/textResponse/index";
import markdownPlugin from "../plugins/markdown/index";
import spreadsheetPlugin from "../plugins/spreadsheet/index";
import MindMapPlugin from "@gui-chat-plugin/mindmap/vue";
import generateImagePlugin from "../plugins/generateImage/index";
import QuizPlugin from "@mulmochat-plugin/quiz/vue";
import presentFormPlugin from "../plugins/presentForm/index";
import canvasPlugin from "../plugins/canvas/index";
import editImagesPlugin from "../plugins/editImages/index";
import Present3DPlugin from "@gui-chat-plugin/present3d/vue";
// `@gui-chat-plugin/weather` is now installed via the user's
// workspace ledger (`~/mulmoclaude/plugins/plugins.json`) rather
// than as a build-time bundle. The View loads via the runtime-plugin
// dynamic-import path; no static import here. (Briefly registered as
// a preset in `server/plugins/preset-list.ts` — that wedged because
// users who'd already installed it via the ledger then saw a
// "name collides" warning on every boot. Until that double-source
// case is handled cleanly, no presets ship by default.)
import todoPlugin from "../plugins/todo/index";
import { manageCalendarPlugin, manageAutomationsPlugin, legacyManageSchedulerEntry } from "../plugins/scheduler/index";
import manageSkillsPlugin from "../plugins/manageSkills/index";
import manageSourcePlugin from "../plugins/manageSource/index";
import wikiPlugin from "../plugins/wiki/index";
import accountingPlugin from "../plugins/accounting/index";
import { TOOL_NAMES } from "../config/toolNames";
import presentMulmoScriptPlugin from "../plugins/presentMulmoScript/index";
import presentHtmlPlugin from "../plugins/presentHtml/index";
import presentChartPlugin from "../plugins/chart/index";

const plugins: Record<string, PluginEntry> = {
  "text-response": textResponsePlugin.plugin,
  manageTodoList: todoPlugin,
  manageCalendar: manageCalendarPlugin,
  manageAutomations: manageAutomationsPlugin,
  // View-only fallback so chat sessions saved before #824
  // continue to render rich tool-result cards. Not exposed to
  // the LLM (absent from server/agent/plugin-names.ts and
  // src/config/toolNames.ts) — strictly historical rendering.
  manageScheduler: legacyManageSchedulerEntry,
  manageSkills: manageSkillsPlugin,
  manageSource: manageSourcePlugin,
  manageWiki: wikiPlugin,
  [TOOL_NAMES.manageAccounting]: accountingPlugin,
  presentMulmoScript: presentMulmoScriptPlugin,
  presentDocument: markdownPlugin,
  presentSpreadsheet: spreadsheetPlugin,
  createMindMap: MindMapPlugin.plugin,
  generateImage: generateImagePlugin,
  putQuestions: QuizPlugin.plugin,
  presentForm: presentFormPlugin,
  openCanvas: canvasPlugin,
  presentHtml: presentHtmlPlugin,
  presentChart: presentChartPlugin,
  [TOOL_NAMES.editImages]: editImagesPlugin,
  present3D: Present3DPlugin.plugin,
  // weather: not statically bundled. See the import comment above —
  // the runtime registry exposes it under `fetchWeather` when the
  // user has installed it via the workspace ledger, and getPlugin()
  // consults that registry below.
};

export function getPlugin(name: string): PluginEntry | null {
  // Static (build-time) plugins win on collision — runtime plugins
  // are registered in mcp-server.ts only when their tool name does
  // not already exist in the static set, so this lookup order keeps
  // the contracts symmetric across server and frontend.
  return plugins[name] ?? getRuntimePluginEntry(name);
}

export function getAllPluginNames(): string[] {
  const staticNames = Object.keys(plugins).filter((name) => !LEGACY_VIEW_ONLY_PLUGIN_NAMES.has(name));
  return [...staticNames, ...getRuntimeToolNames()];
}
