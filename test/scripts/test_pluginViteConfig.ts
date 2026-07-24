import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { vuePluginBuild, createVuePluginConfig, serverPluginBuild, createServerPluginConfig, SERVER_DTS_OPTIONS } from "../../scripts/lib/pluginViteConfig.js";

describe("vuePluginBuild — Family A (Vue multi-entry, dual ESM+CJS)", () => {
  it("emits the shared dual-format library policy (chart-plugin shape)", () => {
    const build = vuePluginBuild({
      entry: { index: "src/index.ts", core: "src/core/index.ts", vue: "src/vue/index.ts" },
      name: "GUIChatPluginChart",
      external: ["vue", "gui-chat-protocol", "gui-chat-protocol/vue", "echarts"],
      globals: { vue: "Vue", echarts: "echarts" },
    });

    assert.deepEqual(build?.lib?.entry, { index: "src/index.ts", core: "src/core/index.ts", vue: "src/vue/index.ts" });
    assert.equal(build?.lib?.name, "GUIChatPluginChart");
    assert.deepEqual(build?.lib?.formats, ["es", "cjs"]);
    assert.deepEqual(build?.rollupOptions?.external, ["vue", "gui-chat-protocol", "gui-chat-protocol/vue", "echarts"]);
    assert.deepEqual(build?.rollupOptions?.output, {
      exports: "named",
      globals: { vue: "Vue", echarts: "echarts" },
      assetFileNames: "style.[ext]",
    });
    assert.equal(build?.cssCodeSplit, false);
  });

  it("maps entryName+format to the dual .js / .cjs artifact names", () => {
    const build = vuePluginBuild({ entry: { index: "src/index.ts" }, external: [] });
    const fileName = build?.lib?.fileName;
    assert.equal(typeof fileName, "function");
    if (typeof fileName === "function") {
      assert.equal(fileName("es", "index"), "index.js");
      assert.equal(fileName("cjs", "index"), "index.cjs");
      assert.equal(fileName("cjs", "core"), "core.cjs");
    }
  });

  it("defaults globals to { vue: 'Vue' } when omitted", () => {
    const build = vuePluginBuild({ entry: { vue: "src/vue/index.ts" }, external: ["vue"] });
    const output = build?.rollupOptions?.output;
    assert.deepEqual(output && !Array.isArray(output) ? output.globals : undefined, { vue: "Vue" });
  });

  it("omits `name` from lib when not provided (accounting/collection shape)", () => {
    const build = vuePluginBuild({ entry: { vue: "src/vue/index.ts" }, external: [] });
    const lib = build?.lib;
    assert.ok(lib);
    assert.equal("name" in lib, false);
  });

  it("omits minify / sourcemap when not provided (chart/html/form keep vite defaults)", () => {
    const build = vuePluginBuild({ entry: { index: "src/index.ts" }, external: [] });
    assert.ok(build);
    assert.equal("minify" in build, false);
    assert.equal("sourcemap" in build, false);
  });

  it("passes through minify:false + sourcemap:true (mulmoscript/accounting/collection)", () => {
    const build = vuePluginBuild({
      entry: { vue: "src/vue/index.ts" },
      external: [/^node:/, /^@mulmoclaude\/core/, "vue"],
      minify: false,
      sourcemap: true,
    });
    assert.equal(build?.minify, false);
    assert.equal(build?.sourcemap, true);
    // RegExp externals survive verbatim.
    assert.deepEqual(build?.rollupOptions?.external, [/^node:/, /^@mulmoclaude\/core/, "vue"]);
  });
});

describe("createVuePluginConfig", () => {
  it("wires the injected plugins through and attaches the build policy", () => {
    const marker = { name: "vue-stub" };
    const config = createVuePluginConfig({
      plugins: [marker],
      entry: { index: "src/index.ts" },
      external: ["vue"],
    });
    assert.deepEqual(config.plugins, [marker]);
    // build policy shape is covered by the vuePluginBuild tests above.
    assert.ok(config.build);
  });
});

describe("serverPluginBuild — Family B (server-only, dts, ESM-only)", () => {
  it("emits the shared single-entry ESM policy with the default entry", () => {
    const build = serverPluginBuild({ external: [/^node:/, /^@mulmoclaude\/core/] });
    assert.deepEqual(build?.lib?.entry, { index: "src/index.ts" });
    assert.deepEqual(build?.lib?.formats, ["es"]);
    assert.deepEqual(build?.rollupOptions?.external, [/^node:/, /^@mulmoclaude\/core/]);
    assert.equal(build?.minify, false);
    assert.equal(build?.sourcemap, true);
  });

  it("emits only external in rollupOptions (no output block)", () => {
    const build = serverPluginBuild({ external: ["node:os", "node:url"] });
    const rollupOptions = build?.rollupOptions;
    assert.ok(rollupOptions);
    assert.equal("output" in rollupOptions, false);
  });

  it("names the single ESM artifact `<entry>.js` for any format", () => {
    const build = serverPluginBuild({ external: [] });
    const fileName = build?.lib?.fileName;
    assert.equal(typeof fileName, "function");
    if (typeof fileName === "function") {
      assert.equal(fileName("es", "index"), "index.js");
    }
  });

  it("accepts a custom entry map", () => {
    const build = serverPluginBuild({ external: [], entry: { index: "src/main.ts" } });
    assert.deepEqual(build?.lib?.entry, { index: "src/main.ts" });
  });
});

describe("createServerPluginConfig", () => {
  it("wires the injected dts plugin through and attaches the build policy", () => {
    const marker = { name: "dts-stub" };
    const config = createServerPluginConfig({ plugins: [marker], external: [/^node:/] });
    assert.deepEqual(config.plugins, [marker]);
    assert.ok(config.build);
  });
});

describe("SERVER_DTS_OPTIONS", () => {
  it("is the byte-for-byte vite-plugin-dts options shared by the server plugins", () => {
    assert.deepEqual(SERVER_DTS_OPTIONS, {
      include: ["src/**/*.ts"],
      outDir: "dist",
      compilerOptions: { rootDir: "src" },
    });
  });
});
