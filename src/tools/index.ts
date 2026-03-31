import type { ToolPlugin } from "./types";
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

const plugins: Record<string, ToolPlugin> = {
  "text-response": TextResponsePlugin.plugin as unknown as ToolPlugin,
  manageTodoList: todoPlugin as unknown as ToolPlugin,
  manageScheduler: schedulerPlugin as unknown as ToolPlugin,
  manageRoles: manageRolesPlugin as unknown as ToolPlugin,
  presentDocument: MarkdownPlugin.plugin as unknown as ToolPlugin,
  presentSpreadsheet: SpreadsheetPlugin.plugin as unknown as ToolPlugin,
  createMindMap: MindMapPlugin.plugin as unknown as ToolPlugin,
  generateImage: GenerateImagePlugin.plugin as unknown as ToolPlugin,
  putQuestions: QuizPlugin.plugin as unknown as ToolPlugin,
  presentForm: FormPlugin.plugin as unknown as ToolPlugin,
  openCanvas: CanvasPlugin.plugin as unknown as ToolPlugin,
  generateHtml: GenerateHtmlPlugin.plugin as unknown as ToolPlugin,
  editHtml: EditHtmlPlugin.plugin as unknown as ToolPlugin,
  editImage: EditImagePlugin.plugin as unknown as ToolPlugin,
  browse: BrowsePlugin.plugin as unknown as ToolPlugin,
  camera: CameraPlugin.plugin as unknown as ToolPlugin,
  music: MusicPlugin.plugin as unknown as ToolPlugin,
  playOthello: OthelloPlugin.plugin as unknown as ToolPlugin,
  piano: PianoPlugin.plugin as unknown as ToolPlugin,
  present3D: Present3DPlugin.plugin as unknown as ToolPlugin,
  weather: WeatherPlugin.plugin as unknown as ToolPlugin,
};

export function getPlugin(name: string): ToolPlugin | null {
  return plugins[name] ?? null;
}

export function getPlugins(names: string[]): Record<string, ToolPlugin> {
  return Object.fromEntries(
    names.flatMap((name) => {
      const plugin = plugins[name];
      return plugin ? [[name, plugin]] : [];
    }),
  );
}

export function getAllPluginNames(): string[] {
  return Object.keys(plugins);
}
