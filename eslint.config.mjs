import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import sonarjs from "eslint-plugin-sonarjs";
import importPlugin from "eslint-plugin-import";
import vuePlugin from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";

export default [
  {
    files: [
      "{src,test}/**/*.{js,ts,yaml,yml,vue}",
      "assets/html/js/**/*.js",
    ],
  },
  {
    ignores: ["lib", "src/plugins/spreadsheet/engine"],
  },
  eslint.configs.recommended,
  sonarjs.configs.recommended,
  ...tseslint.configs.recommended,
  ...vuePlugin.configs["flat/recommended"],
  {
    files: [
      "**/utils/html_render.ts",
      "src/utils/dom/**/*.ts",
      "src/composables/**/*.ts",
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.es2021,
        ...globals.node,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      indent: ["error", 2],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^__",
          varsIgnorePattern: "^__",
          caughtErrorsIgnorePattern: "^__",
        },
      ],
      "linebreak-style": ["error", "unix"],
      quotes: "off",
      "no-shadow": "error",
      "no-param-reassign": "error",
      // "no-plusplus": "error",
      "preserve-caught-error": "off",
      "no-undef": "error",
      "prefer-const": "error",
      "no-return-assign": "error",
      "object-shorthand": "error",
      semi: ["error", "always"],
      "prettier/prettier": "error",
      "no-console": "off",
      "import/no-cycle": "error",
      "sonarjs/no-ignored-exceptions": "error",
      "sonarjs/todo-tag": "off",
      "sonarjs/no-commented-code": "off",
      "sonarjs/no-nested-conditional": "off",
      "sonarjs/cognitive-complexity": "error",
      // `@typescript-eslint/no-unused-vars` already covers this and
      // honours the `^__` ignore pattern (see its options above); the
      // sonarjs version has no configurable options so it can't
      // exempt intentionally-discarded destructuring targets like
      // `const { result: __result, ...rest } = ...`. Disable to avoid
      // double-reporting and to let the `__` convention work.
      "sonarjs/no-unused-vars": "off",
      // MulmoClaude is a local desktop app — spawning claude/docker/git
      // via PATH is normal operation, not a server-side injection risk.
      "sonarjs/no-os-command-from-path": "off",
      "sonarjs/cors": "off"
    },
    plugins: {
      prettier: prettierPlugin,
      import: importPlugin,
    },
  },
  {
    // Test & E2E override. Tests legitimately use things that the
    // sonarjs rule set flags as insecure in production code:
    // /tmp directories for fixtures, chmod bits in fs-permission
    // tests, http://localhost in CSRF / CORS tests. And Playwright
    // specs need the full browser global set. Narrow the override
    // to just those categories so no-shadow / cognitive-complexity /
    // no-unused-vars / no-floating-promises etc. stay at `error`
    // across the whole repo — those *do* catch real bugs in tests.
    files: ["test/**/*.{ts,js}", "e2e/**/*.{ts,js}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "sonarjs/publicly-writable-directories": "off",
      "sonarjs/file-permissions": "off",
      "sonarjs/no-clear-text-protocols": "off",
      // Playwright / jsdom-style specs commonly use `any`-ish casts
      // against DOM types to build minimal mocks. Keep
      // `no-explicit-any` at `error` in production code; demote to
      // warn inside tests.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Vue SFC override — must come AFTER the main rules block so
    // our per-rule overrides actually take effect (flat config's
    // last-match-wins semantics). `vue-eslint-parser` is needed so
    // `<script lang="ts">` is parsed correctly; without it, every
    // type annotation looks like a syntax error.
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        sourceType: "module",
        extraFileExtensions: [".vue"],
      },
      globals: {
        // Vue SFCs run in the browser; add globals so `document`,
        // `MouseEvent`, `HTMLElement`, `FileReader`, `alert`,
        // `window`, etc. aren't flagged as undefined.
        ...globals.browser,
      },
    },
    rules: {
      // MulmoClaude plugin convention: `View` / `Preview` are the
      // canonical component names per plugin directory
      // (`src/plugins/<name>/View.vue`). The Vue-recommended rule
      // against single-word names fights that on purpose.
      "vue/multi-word-component-names": "off",
      // `wiki/View.vue` uses `v-html` intentionally to render
      // sanitised markdown. Warn so the justified usage doesn't
      // block CI — audit per-use at review time.
      "vue/no-v-html": "warn",
    },
  },
  eslintConfigPrettier,
];
