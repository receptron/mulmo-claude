import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

// Two bundles, two externals strategies (mirroring bookmarks-plugin):
//
// - `dist/index.js` (server) — self-contained. Runtime loader extracts
//   the tarball into `~/mulmoclaude/plugins/.cache/<pkg>/<ver>/` with
//   no node_modules underneath, so any bare import left as `external`
//   breaks at load time. Inline `gui-chat-protocol` (just the identity
//   `definePlugin` helper), `zod`, and `@mulmoclaude/common` (the tiny
//   zero-dep leaf holding `errorMessage` / `escapeHtml`).
//
// - `dist/vue.js` (browser) — `vue` and `gui-chat-protocol/vue` stay
//   external; the host provides Vue via the importmap and
//   `useRuntime()` resolves to the host's instance.
export default defineConfig({
  // No `rollupTypes: true`: that would route the d.ts emit through
  // `@microsoft/api-extractor`, which (as of 7.58.7) bundles a TS
  // 5.9.3 compiler engine and silently drops every export when the
  // workspace runs on TS 6+. Per-file d.ts emit by `vite-plugin-dts`
  // uses the workspace's own tsc, so it tracks the toolchain.
  // `compilerOptions.rootDir: "src"` strips `src/` from the d.ts
  // paths so `dist/index.d.ts` matches the package.json `exports`
  // map (would otherwise emit to `dist/src/index.d.ts`).
  plugins: [
    vue(),
    dts({
      include: ["src/**/*.{ts,vue}"],
      outDir: "dist",
      compilerOptions: { rootDir: "src" },
    }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts", vue: "src/vue.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["vue", "gui-chat-protocol/vue"],
      output: {
        // Pin the CSS asset name to `style.css` so the host's runtime
        // loader doesn't have to special-case per plugin.
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "style.css";
          return assetInfo.name ?? "[name]";
        },
      },
    },
    minify: false,
    sourcemap: true,
  },
});
