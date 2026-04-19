import type { PluginEntry } from "./types";
import textResponsePlugin from "../plugins/textResponse/index";
import markdownPlugin from "../plugins/markdown/index";
import spreadsheetPlugin from "../plugins/spreadsheet/index";
import MindMapPlugin from "@gui-chat-plugin/mindmap/vue";
import generateImagePlugin from "../plugins/generateImage/index";
import QuizPlugin from "@mulmochat-plugin/quiz/vue";
import FormPlugin from "@mulmochat-plugin/form/vue";
import canvasPlugin from "../plugins/canvas/index";
import editImagePlugin from "../plugins/editImage/index";
import Present3DPlugin from "@gui-chat-plugin/present3d/vue";
import WeatherPlugin from "@gui-chat-plugin/weather/vue";
import todoPlugin from "../plugins/todo/index";
import schedulerPlugin from "../plugins/scheduler/index";
import manageRolesPlugin from "../plugins/manageRoles/index";
import manageSkillsPlugin from "../plugins/manageSkills/index";
import manageSourcePlugin from "../plugins/manageSource/index";
import wikiPlugin from "../plugins/wiki/index";
import presentMulmoScriptPlugin from "../plugins/presentMulmoScript/index";
import presentHtmlPlugin from "../plugins/presentHtml/index";
import presentChartPlugin from "../plugins/chart/index";

const plugins: Record<string, PluginEntry> = {
  "text-response": textResponsePlugin.plugin,
  manageTodoList: todoPlugin,
  manageScheduler: schedulerPlugin,
  manageRoles: manageRolesPlugin,
  manageSkills: manageSkillsPlugin,
  manageSource: manageSourcePlugin,
  manageWiki: wikiPlugin,
  presentMulmoScript: presentMulmoScriptPlugin,
  presentDocument: markdownPlugin,
  presentSpreadsheet: spreadsheetPlugin,
  createMindMap: MindMapPlugin.plugin,
  generateImage: generateImagePlugin,
  putQuestions: QuizPlugin.plugin,
  presentForm: FormPlugin.plugin,
  openCanvas: canvasPlugin,
  presentHtml: presentHtmlPlugin,
  presentChart: presentChartPlugin,
  editImage: editImagePlugin,
  present3D: Present3DPlugin.plugin,
  weather: WeatherPlugin.plugin,
};

export function getPlugin(name: string): PluginEntry | null {
  return plugins[name] ?? null;
}

export function getAllPluginNames(): string[] {
  return Object.keys(plugins);
}
