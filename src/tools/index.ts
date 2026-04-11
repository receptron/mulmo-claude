import type { PluginEntry } from "./types";
import TextResponsePlugin from "@gui-chat-plugin/text-response/vue";
import TextResponseView from "../plugins/textResponse/View.vue";
import MarkdownPlugin from "@gui-chat-plugin/markdown/vue";
import SpreadsheetPlugin from "@gui-chat-plugin/spreadsheet/vue";
import MindMapPlugin from "@gui-chat-plugin/mindmap/vue";
import GenerateImagePlugin from "@mulmochat-plugin/generate-image/vue";
import QuizPlugin from "@mulmochat-plugin/quiz/vue";
import FormPlugin from "@mulmochat-plugin/form/vue";
import CanvasPlugin from "@gui-chat-plugin/canvas/vue";
import EditImagePlugin from "@gui-chat-plugin/edit-image/vue";
import MusicPlugin from "@gui-chat-plugin/music/vue";
import PianoPlugin from "@gui-chat-plugin/piano/vue";
import Present3DPlugin from "@gui-chat-plugin/present3d/vue";
import WeatherPlugin from "@gui-chat-plugin/weather/vue";
import todoPlugin from "../plugins/todo/index";
import schedulerPlugin from "../plugins/scheduler/index";
import manageRolesPlugin from "../plugins/manageRoles/index";
import wikiPlugin from "../plugins/wiki/index";
import presentMulmoScriptPlugin from "../plugins/presentMulmoScript/index";
import presentHtmlPlugin from "../plugins/presentHtml/index";

const plugins: Record<string, PluginEntry> = {
  "text-response": {
    ...TextResponsePlugin.plugin,
    viewComponent: TextResponseView,
  },
  manageTodoList: todoPlugin,
  manageScheduler: schedulerPlugin,
  manageRoles: manageRolesPlugin,
  manageWiki: wikiPlugin,
  presentMulmoScript: presentMulmoScriptPlugin,
  presentDocument: MarkdownPlugin.plugin,
  presentSpreadsheet: SpreadsheetPlugin.plugin,
  createMindMap: MindMapPlugin.plugin,
  generateImage: GenerateImagePlugin.plugin,
  putQuestions: QuizPlugin.plugin,
  presentForm: FormPlugin.plugin,
  openCanvas: CanvasPlugin.plugin,
  presentHtml: presentHtmlPlugin,
  editImage: EditImagePlugin.plugin,
  showMusic: MusicPlugin.plugin,
  piano: PianoPlugin.plugin,
  present3D: Present3DPlugin.plugin,
  weather: WeatherPlugin.plugin,
};

export function getPlugin(name: string): PluginEntry | null {
  return plugins[name] ?? null;
}

export function getAllPluginNames(): string[] {
  return Object.keys(plugins);
}
