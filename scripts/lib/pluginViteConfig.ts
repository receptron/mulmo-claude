// Shared Vite build policy for the gui-chat-protocol plugin packages (#2409).
//
// Pure: imports only `import type` from vite, so it carries zero runtime deps
// and is unit-testable without loading @vitejs/plugin-vue / @tailwindcss/vite /
// vite-plugin-dts. Plugin instances are dependency-injected by each config, so
// the vue/tailwind/dts imports stay in the package that owns those devDeps.
//
// Per the #2409 design note, this hides ONLY the parts that are identical across
// a family; every config still declares its own entry / external / name / globals.

import type { LibraryFormats, PluginOption, UserConfig } from "vite";

const DEFAULT_VUE_GLOBALS: Record<string, string> = { vue: "Vue" };

const DEFAULT_SERVER_ENTRY: Record<string, string> = { index: "src/index.ts" };

type LibFileName = (format: string, entryName: string) => string;

// Dual ESM+CJS: `.js` for `import`, `.cjs` for the host's Docker CJS `require`.
const dualFormatFileName: LibFileName = (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`;

const esFileName: LibFileName = (_format, entryName) => `${entryName}.js`;

// -- Family A: Vue multi-entry library, dual ESM+CJS ------------------------

export interface VuePluginConfigOptions {
  plugins: PluginOption[];
  entry: Record<string, string>;
  external: (string | RegExp)[];
  name?: string;
  globals?: Record<string, string>;
  minify?: boolean;
  sourcemap?: boolean;
}

interface VueLibBuild {
  lib: { entry: Record<string, string>; name?: string; formats: LibraryFormats[]; fileName: LibFileName };
  rollupOptions: { external: (string | RegExp)[]; output: { exports: "named"; globals: Record<string, string>; assetFileNames: string } };
  cssCodeSplit: boolean;
  minify?: boolean;
  sourcemap?: boolean;
}

export function vuePluginBuild(options: Omit<VuePluginConfigOptions, "plugins">): VueLibBuild {
  const { entry, external, name, globals, minify, sourcemap } = options;
  return {
    lib: {
      entry,
      ...(name === undefined ? {} : { name }),
      formats: ["es", "cjs"],
      fileName: dualFormatFileName,
    },
    rollupOptions: {
      external,
      output: {
        exports: "named",
        globals: globals ?? DEFAULT_VUE_GLOBALS,
        assetFileNames: "style.[ext]",
      },
    },
    cssCodeSplit: false,
    ...(minify === undefined ? {} : { minify }),
    ...(sourcemap === undefined ? {} : { sourcemap }),
  };
}

export function createVuePluginConfig(options: VuePluginConfigOptions): UserConfig {
  return { plugins: options.plugins, build: vuePluginBuild(options) };
}

// -- Family B: server-only, single-entry, vite-plugin-dts, ESM-only ---------

export interface ServerDtsOptions {
  include: string[];
  outDir: string;
  compilerOptions: { rootDir: string };
}

// The vite-plugin-dts options copied byte-for-byte across the server plugins.
// Passed to the caller's own `dts(...)` so the import stays local.
export const SERVER_DTS_OPTIONS: ServerDtsOptions = {
  include: ["src/**/*.ts"],
  outDir: "dist",
  compilerOptions: { rootDir: "src" },
};

export interface ServerPluginConfigOptions {
  plugins: PluginOption[];
  external: (string | RegExp)[];
  entry?: Record<string, string>;
}

interface ServerLibBuild {
  lib: { entry: Record<string, string>; formats: LibraryFormats[]; fileName: LibFileName };
  rollupOptions: { external: (string | RegExp)[] };
  minify: boolean;
  sourcemap: boolean;
}

export function serverPluginBuild(options: Omit<ServerPluginConfigOptions, "plugins">): ServerLibBuild {
  return {
    lib: {
      entry: options.entry ?? DEFAULT_SERVER_ENTRY,
      formats: ["es"],
      fileName: esFileName,
    },
    rollupOptions: { external: options.external },
    minify: false,
    sourcemap: true,
  };
}

export function createServerPluginConfig(options: ServerPluginConfigOptions): UserConfig {
  return { plugins: options.plugins, build: serverPluginBuild(options) };
}
