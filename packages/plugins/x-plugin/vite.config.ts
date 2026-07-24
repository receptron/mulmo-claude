import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Server-only plugin: one entry, no Vue. Mirrors edgar-plugin's build.
// Unlike sandboxed runtime plugins, this package is imported directly by
// the host server build (like @mulmoclaude/{form,markdown}-plugin), so it
// may use global `fetch` and `process.env` freely. Node built-ins are
// externalized; `@mulmoclaude/common` (the only runtime dep, a tiny pure
// leaf) is inlined — the same convention as markdown/accounting-plugin.
export default defineConfig({
  plugins: [
    dts({
      include: ["src/**/*.ts"],
      outDir: "dist",
      compilerOptions: { rootDir: "src" },
    }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts" },
      // Dual ESM + CJS so `require("@mulmoclaude/x-plugin")` works under the
      // host's Docker CJS mode (the package.json `require` condition points at
      // the .cjs artifact). Named exports only — no default.
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      output: { exports: "named" },
    },
    minify: false,
    sourcemap: true,
  },
});
