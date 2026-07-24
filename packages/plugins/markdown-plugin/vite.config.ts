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
  name: "GUIChatPluginMarkdown",
  // Externalise the host-shared / heavy deps so the host bundles a single copy.
  // gui-chat-protocol MUST be external so the injected PLUGIN_RUNTIME_KEY Symbol
  // matches the host's provider.
  external: [/^@mulmoclaude\/core/, "vue", "gui-chat-protocol", "gui-chat-protocol/vue", "marked", "js-yaml", "@marp-team/marp-core"],
});
