import type { PluginEntry } from "./types";
import TextResponsePlugin from "@gui-chat-plugin/text-response/vue";
import MarkdownPlugin from "@gui-chat-plugin/markdown/vue";
import SpreadsheetPlugin from "@gui-chat-plugin/spreadsheet/vue";
import MindMapPlugin from "@gui-chat-plugin/mindmap/vue";
import GenerateImagePlugin from "@mulmochat-plugin/generate-image/vue";
import QuizPlugin from "@mulmochat-plugin/quiz/vue";
import FormPlugin from "@mulmochat-plugin/form/vue";
import CanvasPlugin from "@gui-chat-plugin/canvas/vue";
import GenerateHtmlPlugin from "@gui-chat-plugin/generate-html/vue";
import EditHtmlPlugin from "@gui-chat-plugin/edit-html/vue";
import EditImagePlugin from "@gui-chat-plugin/edit-image/vue";
import BrowsePlugin from "@gui-chat-plugin/browse/vue";
import CameraPlugin from "@gui-chat-plugin/camera/vue";
import MusicPlugin from "@gui-chat-plugin/music/vue";
import OthelloPlugin from "@gui-chat-plugin/othello/vue";
import PianoPlugin from "@gui-chat-plugin/piano/vue";
import Present3DPlugin from "@gui-chat-plugin/present3d/vue";
import WeatherPlugin from "@gui-chat-plugin/weather/vue";
import todoPlugin from "../plugins/todo/index";
import schedulerPlugin from "../plugins/scheduler/index";
import manageRolesPlugin from "../plugins/manageRoles/index";
import presentMulmoScriptPlugin from "../plugins/presentMulmoScript/index";

const plugins: Record<string, PluginEntry> = {
  "text-response": TextResponsePlugin.plugin,
  manageTodoList: todoPlugin,
  manageScheduler: schedulerPlugin,
  manageRoles: manageRolesPlugin,
  presentMulmoScript: presentMulmoScriptPlugin,
  presentDocument: MarkdownPlugin.plugin,
  presentSpreadsheet: SpreadsheetPlugin.plugin,
  createMindMap: MindMapPlugin.plugin,
  generateImage: GenerateImagePlugin.plugin,
  putQuestions: QuizPlugin.plugin,
  presentForm: FormPlugin.plugin,
  openCanvas: CanvasPlugin.plugin,
  generateHtml: GenerateHtmlPlugin.plugin,
  editHtml: EditHtmlPlugin.plugin,
  editImage: EditImagePlugin.plugin,
  browse: BrowsePlugin.plugin,
  camera: CameraPlugin.plugin,
  showMusic: MusicPlugin.plugin,
  playOthello: OthelloPlugin.plugin,
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
