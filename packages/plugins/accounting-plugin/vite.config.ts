import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { createVuePluginConfig } from "../../../scripts/lib/pluginViteConfig";

// Three-surface package built as a multi-entry library:
//   · ./shared — isomorphic enums/meta (browser-safe; no node:*, no vue)
//   · ./vue    — chat View/Preview + canvas app (added in stage 2)
//   · ./server — createAccountingRouter (added in stage 3; express + node)
//
// One vite config covers all three; the vue()/tailwind() plugins are
// no-ops for the .ts-only entries. `.d.ts` is emitted by vue-tsc (see the
// build script), which handles both .ts and .vue — vite-plugin-dts can't
// type SFCs. Dual ESM + CJS so `require(...)` works under the host's
// Docker CJS mode (package.json `require` condition → .cjs artifact).
export default createVuePluginConfig({
  plugins: [vue(), tailwindcss()],
  entry: { shared: "src/shared/index.ts", vue: "src/vue/index.ts", server: "src/server/index.ts" },
  // node built-ins + peer libs stay external (resolved from node_modules
  // at runtime); only the package's own modules are bundled.
  external: [/^node:/, /^@mulmoclaude\/core/, "express", "gui-chat-protocol", "gui-chat-protocol/vue", "vue", "vue-i18n"],
  minify: false,
  sourcemap: true,
});
