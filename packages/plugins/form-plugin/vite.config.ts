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
  name: "GUIChatPluginForm",
  // gui-chat-protocol is externalized (not bundled) so the plugin and host
  // share ONE module instance — critical for the injected PLUGIN_RUNTIME_KEY
  // Symbol to match the host's provider.
  external: ["vue", "gui-chat-protocol", "gui-chat-protocol/vue"],
});
