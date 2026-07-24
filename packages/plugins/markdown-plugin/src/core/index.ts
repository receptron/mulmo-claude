export { TOOL_NAME, isFilePath } from "../plugins/markdown/definition";
export type { MarkdownToolData, MarkdownArgs } from "../plugins/markdown/definition";
export { TOOL_DEFINITION } from "../plugins/markdown/definition";
export { pluginCore, executeDocument } from "./plugin";
export { executeMarkdown } from "../plugins/markdown/core";
export type { MarkdownExecuteContext } from "../plugins/markdown/core";
export type { MarkdownHostApp, MarkdownDispatchArgs, MarkdownDispatchResult, ExportPdfOptions, MarpThemeEntry } from "../plugins/markdown/contract";
// Hosts whose workspace file server is not `/api/files/raw` call this.
export { setFilesRawUrl } from "@mulmoclaude/markdown-utils/image/resolve";
// Shared Marp render core — both hosts' PDF export + the MarpView preview.
export { renderMarpDeck, DEFAULT_SLIDE_WIDTH, DEFAULT_SLIDE_HEIGHT } from "../render/marp";
export type { RenderMarpOptions, RenderMarpResult } from "../render/marp";
// Shared image-placeholder fill — host injects image generation + storage.
export { fillImagePlaceholders, buildImagePlaceholderReplacement, IMAGE_PLACEHOLDER } from "../render/imageFill";
export type { FillImagePlaceholdersDeps, ImagePlaceholderResult } from "../render/imageFill";
