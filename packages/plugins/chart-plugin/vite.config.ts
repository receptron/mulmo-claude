import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { createVuePluginConfig } from "../../../scripts/lib/pluginViteConfig";

export default createVuePluginConfig({
  plugins: [vue(), tailwindcss()],
  entry: {
    index: resolve(__dirname, "src/index.ts"),
    core: resolve(__dirname, "src/core/index.ts"),
    vue: resolve(__dirname, "src/vue/index.ts"),
  },
  name: "GUIChatPluginChart",
  // Externalized so the plugin and host share ONE instance: `@mulmoclaude/core`
  // + `vue` + `gui-chat-protocol/vue` for the injected PLUGIN_RUNTIME_KEY Symbol,
  // and `echarts` so the host's single charting engine is reused.
  external: [/^@mulmoclaude\/core/, "vue", "gui-chat-protocol", "gui-chat-protocol/vue", "echarts"],
  globals: { vue: "Vue", echarts: "echarts" },
});
