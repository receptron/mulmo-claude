import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { createVuePluginConfig } from "../../../scripts/lib/pluginViteConfig";

// Three entries: the server-facing `.`/core (tool definition + execute, which
// only type-imports gui-chat-protocol) and the browser `./vue` (View/Preview +
// the Three.js renderer). `vue` and `gui-chat-protocol/vue` are externalised so
// the plugin and host share ONE instance (the injected PLUGIN_RUNTIME_KEY
// Symbol must match). `three` and the CSG helpers are intentionally bundled —
// the runtime loader extracts the tarball into a cache dir with no
// node_modules underneath, so bare imports left external cannot resolve.
// `@mulmoclaude/core` is a peer (the host provides it) — its browser-safe
// `./artifacts` entry supplies the shared artifact path rules.
export default createVuePluginConfig({
  plugins: [vue(), tailwindcss()],
  entry: {
    index: resolve(__dirname, "src/index.ts"),
    core: resolve(__dirname, "src/core/index.ts"),
    vue: resolve(__dirname, "src/vue/index.ts"),
    render: resolve(__dirname, "src/render/index.ts"),
  },
  name: "MulmoClaudePluginShapeScript",
  // `puppeteer` and the node built-ins belong to the SERVER-only `./render` entry:
  // external so a browser driver is never bundled, and so the host's own hoisted
  // copy is the one that runs.
  external: [
    /^@mulmoclaude\/core/,
    "vue",
    "gui-chat-protocol",
    "gui-chat-protocol/vue",
    "puppeteer",
    "node:fs/promises",
    "node:module",
    "node:path",
    "node:url",
  ],
});
