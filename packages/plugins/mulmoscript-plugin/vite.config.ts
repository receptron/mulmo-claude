import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { createVuePluginConfig } from "../../../scripts/lib/pluginViteConfig";

// Three entries: the browser-safe `.` core (save/update executes + tool
// definition), the browser `./vue` (View/Preview), and the Node-only
// `./server` (mulmocast ops + dispatch router). `vue` +
// `gui-chat-protocol/vue` are externalised so the plugin and host share ONE
// instance (the injected PLUGIN_RUNTIME_KEY Symbol must match);
// `@mulmocast/*` / `mulmocast` / `graphai` are externalised so both hosts
// resolve their own single hoisted copies (GraphAILogger state is
// module-local — a bundled second copy would silently break the error
// capture). Node built-ins are externalised for the server entry.
// Declarations are emitted by vue-tsc (tsconfig.build.json) because
// vite-plugin-dts and the Vue SFC transform disagree about .vue d.ts paths.
export default createVuePluginConfig({
  plugins: [vue(), tailwindcss()],
  entry: {
    index: resolve(__dirname, "src/index.ts"),
    vue: resolve(__dirname, "src/vue/index.ts"),
    server: resolve(__dirname, "src/server/index.ts"),
  },
  name: "GUIChatPluginMulmoScript",
  external: [
    /^@mulmoclaude\/core/,
    "vue",
    "gui-chat-protocol",
    "gui-chat-protocol/vue",
    "@mulmocast/types",
    "@mulmocast/deck-web",
    "mulmocast",
    "graphai",
    "fs",
    "path",
    "node:async_hooks",
    "node:fs/promises",
  ],
  minify: false,
  sourcemap: true,
});
