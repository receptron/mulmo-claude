// Public entry for `@mulmoclaude/core/plugin-vue` — the browser-safe Vue surface shared
// by plugin Views and the host. Server-only consumers never import this subpath, so `vue`
// stays an optional peer of core.
export { useFileWatch, useFileVersion, type SubscribeToFile } from "./useFileWatch.ts";
export { nextFileVersion, type FileChangePayload } from "./fileWatch.ts";
export { useMarkdownDoc } from "./useMarkdownDoc.ts";
export { formatScalarField, buildMarkdownDocView, type MarkdownDocField, type MarkdownDocView } from "./markdownDoc.ts";
export { useClipboardCopy, type UseClipboardCopyHandle } from "./useClipboardCopy.ts";
// `createPluginI18n` deliberately lives on its own `./plugin-vue/i18n` subpath, NOT in
// this barrel: it imports `vue-i18n` (an optional peer), and re-exporting it here would
// force every barrel consumer (html/markdown plugin Views, hosts without i18n) to
// resolve `vue-i18n` at module-load time.
