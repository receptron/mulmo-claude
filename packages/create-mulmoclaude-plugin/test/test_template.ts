// Tests for the template content + placeholder substitution.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyPlaceholders, PLUGIN_NAME_PLACEHOLDER, TEMPLATE_FILES } from "../src/template.js";

describe("TEMPLATE_FILES — shape", () => {
  it("includes every file the plugin layout needs", () => {
    const paths = TEMPLATE_FILES.map((entry) => entry.path).sort();
    assert.deepEqual(
      paths,
      [
        ".gitignore",
        "README.md",
        "eslint.config.mjs",
        "package.json",
        "src/View.vue",
        "src/definition.ts",
        "src/index.ts",
        "src/lang/en.ts",
        "src/lang/index.ts",
        "src/lang/ja.ts",
        "src/shims-vue.d.ts",
        "src/vue.ts",
        "tsconfig.json",
        "vite.config.ts",
      ].sort(),
    );
  });

  it("every entry has non-empty content", () => {
    for (const entry of TEMPLATE_FILES) {
      assert.ok(entry.content.length > 0, `empty content: ${entry.path}`);
    }
  });

  it("uses POSIX path separators only", () => {
    for (const entry of TEMPLATE_FILES) {
      assert.equal(entry.path.includes("\\"), false, `Windows separator in ${entry.path}`);
    }
  });
});

describe("applyPlaceholders", () => {
  it("substitutes {{PLUGIN_NAME}} verbatim — package.json", () => {
    const pkg = TEMPLATE_FILES.find((entry) => entry.path === "package.json");
    assert.ok(pkg);
    assert.match(pkg.content, /"name": "\{\{PLUGIN_NAME\}\}"/);
    const result = applyPlaceholders(pkg.content, "my-plugin");
    assert.match(result, /"name": "my-plugin"/);
    assert.doesNotMatch(result, /\{\{PLUGIN_NAME\}\}/);
  });

  it("substitutes scoped names too", () => {
    const pkg = TEMPLATE_FILES.find((entry) => entry.path === "package.json");
    assert.ok(pkg);
    const result = applyPlaceholders(pkg.content, "@example/cool-plugin");
    assert.match(result, /"name": "@example\/cool-plugin"/);
  });

  it("substitutes README's {{PLUGIN_NAME}} mentions in every place", () => {
    const readme = TEMPLATE_FILES.find((entry) => entry.path === "README.md");
    assert.ok(readme);
    const occurrences = readme.content.split(PLUGIN_NAME_PLACEHOLDER).length - 1;
    assert.ok(occurrences >= 2, `README should reference plugin name multiple times; got ${occurrences}`);
    const result = applyPlaceholders(readme.content, "my-plugin");
    assert.doesNotMatch(result, /\{\{PLUGIN_NAME\}\}/);
  });

  it("leaves files without placeholders unchanged", () => {
    const tsconfig = TEMPLATE_FILES.find((entry) => entry.path === "tsconfig.json");
    assert.ok(tsconfig);
    const result = applyPlaceholders(tsconfig.content, "my-plugin");
    assert.equal(result, tsconfig.content);
  });
});

describe("template — server / browser entry shape", () => {
  it("server entry references definePlugin", () => {
    const indexTs = TEMPLATE_FILES.find((entry) => entry.path === "src/index.ts");
    assert.ok(indexTs);
    assert.match(indexTs.content, /definePlugin/);
    assert.match(indexTs.content, /TOOL_DEFINITION/);
    assert.match(indexTs.content, /pubsub\.publish/);
    assert.match(indexTs.content, /files\.data/);
  });

  it("browser entry exports the plugin shape the host expects", () => {
    const vueTs = TEMPLATE_FILES.find((entry) => entry.path === "src/vue.ts");
    assert.ok(vueTs);
    assert.match(vueTs.content, /toolDefinition/);
    assert.match(vueTs.content, /viewComponent/);
  });

  it("View uses the runtime composable", () => {
    const view = TEMPLATE_FILES.find((entry) => entry.path === "src/View.vue");
    assert.ok(view);
    assert.match(view.content, /useRuntime/);
    assert.match(view.content, /pubsub\.subscribe/);
  });

  it("i18n locale guard is own-property, not a prototype-chain `in` lookup", () => {
    // The seed is copied into every scaffolded plugin. A `value in MESSAGES`
    // check treats a host locale of `constructor` / `toString` as supported,
    // then indexes MESSAGES to an inherited function and blanks every label.
    const lang = TEMPLATE_FILES.find((entry) => entry.path === "src/lang/index.ts");
    assert.ok(lang);
    assert.match(lang.content, /Object\.hasOwn\(MESSAGES, value\)/);
    assert.doesNotMatch(lang.content, /return value in MESSAGES/);
  });
});
