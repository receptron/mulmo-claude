import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { createVuePluginConfig } from "../../../scripts/lib/pluginViteConfig";

// `./vue` = browser UI layer (composition API + SFCs), imported only by the host
// frontend. The isomorphic engine + node storage engine moved to
// @mulmoclaude/core/collection(+/server); this package is now Vue-only and imports
// the engine from there (externalized below). Dual ESM + CJS preserved.
//
// Vue SFCs need @vitejs/plugin-vue; their Tailwind utility classes compile into
// a single dist/style.css (via @tailwindcss/vite, scanning this package's own
// sources) which the host imports — node_modules isn't in the host's Tailwind
// content scan, so the package must ship its own classes. `.d.ts` is emitted by
// vue-tsc (see the build script), not vite-plugin-dts, because the latter can't
// type SFCs.
export default createVuePluginConfig({
  plugins: [vue(), tailwindcss()],
  entry: { vue: "src/vue/index.ts" },
  // node built-ins + the @mulmoclaude/core engine + zod + gui-chat-protocol(/vue)
  // + vue + vue-i18n stay external (resolved from node_modules at runtime); only
  // the package's own Vue modules are bundled. `gui-chat-protocol/vue` is
  // externalized so plugin and host share ONE injected PLUGIN_RUNTIME_KEY Symbol.
  // `echarts` is external too (peer dep) so the Map tab reuses the host's
  // single charting engine, same as chart-plugin.
  external: [/^node:/, /^@mulmoclaude\/core/, "zod", "gui-chat-protocol", "gui-chat-protocol/vue", "vue", "vue-i18n", "vuedraggable", "echarts"],
  minify: false,
  sourcemap: true,
});
