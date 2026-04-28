import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import sonarjs from "eslint-plugin-sonarjs";
import securityPlugin from "eslint-plugin-security";
import importPlugin from "eslint-plugin-import";
import vuePlugin from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import vueI18n from "@intlify/eslint-plugin-vue-i18n"

export default [
  {
    files: [
      "{src,test}/**/*.{js,ts,yaml,yml,vue}",
      "assets/html/js/**/*.js",
    ],
  },
  {
    ignores: [
      "lib",
      "src/plugins/spreadsheet/engine",
      "packages/*/dist",
      "packages/bridges/*/dist",
      // mulmoclaude launcher copies server/client/shared src here at
      // publish time. Original sources are linted at their real paths.
      "packages/mulmoclaude/client",
      "packages/mulmoclaude/server",
      "packages/mulmoclaude/src",
      // Deliberately-minimal TS snippets that exercise the
      // import-extraction regex in scripts/mulmoclaude/deps.mjs.
      // They're inputs to a parser test, not production code.
      "test/scripts/mulmoclaude/fixtures",
      // esbuild output committed to git (`yarn build:hooks`
      // regenerates from server/workspace/wiki-history/hook/snapshot.ts).
      // Linting the bundle is meaningless — it's machine-formatted
      // and would force formatter-friendly output options on
      // esbuild for no real win.
      "server/workspace/wiki-history/hook/snapshot.mjs",
    ],
  },
  eslint.configs.recommended,
  sonarjs.configs.recommended,
  securityPlugin.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  ...vuePlugin.configs["flat/recommended"],
  ...vueI18n.configs.recommended,
  {
    // Point `@intlify/vue-i18n/*` rules at the JSON cache generated
    // by `yarn dumpi18n` (which serialises src/lang/*.ts). Without
    // `localeDir`, the plugin can't validate key references and
    // surfaces a global "You need to set 'localeDir'" warning on
    // every lint run.
    settings: {
      "vue-i18n": {
        localeDir: ".i18n-cache/*.{json}",
        messageSyntaxVersion: "^11.0.0",
      },
    },
    rules: {
      // Material Icon ligatures, symbol glyphs, and technical
      // identifiers rendered verbatim in templates (inside
      // <span class="material-icons">, <code>, <kbd>) are not
      // translatable content. Filter them out centrally so real
      // translatable strings remain visible in the lint output.
      "@intlify/vue-i18n/no-raw-text": [
        "error",
        {
          ignoreNodes: ["code", "kbd", "pre", "tt", "v-pre"],
          ignorePattern:
            // snake_case single token → Material Icon name
            // (e.g. "chevron_left", "expand_more", "picture_as_pdf")
            // Also covers short lowercase single-word icon names
            // like "add" / "delete" / "edit" / "save" / "undo".
            "^(?:[a-z]+(?:_[a-z]+)*|↺|✕|‹|›|▲|▼|♪|⚠|📅|📊|☑|✓|○|🔑|📁|99\\+|·\\s*|\\+|:|\\s+)$",
          ignoreText: [
            "MulmoClaude",
            "GEMINI_API_KEY",
            ".env",
            "data/",
            "artifacts/",
            "flat",
            "by-name",
            "by-date",
            "claude mcp",
            "mcp__",
            "--allowedTools",
            "host.docker.internal",
            "/",
            "s",
            "?",
            "(",
            ")",
          ],
        },
      ],
    },
  },
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
      // Loop iterators (i/j), throwaway (_), and the Result-pattern
      // discriminator (ok) are the only exempted short names. Everything
      // else — fs/os namespace imports, id/md/ms abbreviations, etc. —
      // must be ≥3 chars. Use named imports (e.g. `{ readFileSync }`
      // from "fs") and descriptive locals (`markdown`, `delayMs`,
      // `itemId`) instead.
      "id-length": [
        "error",
        {
          min: 3,
          // Don't flag object property keys — external API payloads
          // legitimately use short keys like `id`, `to`, `n`, `e`.
          properties: "never",
          exceptions: [
            "_",
            "i",
            "j",
            "ok"
          ],
        },
      ],
      // Catch TDZ-style `use-before-define` (e.g. accessing a `const`
      // before its declaration line). #920. Function declarations are
      // exempt — TS hoists them safely, and top-down narrative-style
      // (`main()` first, helpers below) is a common pattern in the
      // codebase. Type references are also exempt: type position is
      // erased at runtime, so the order doesn't affect execution.
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": [
        "error",
        {
          functions: false,
          classes: true,
          variables: true,
          enums: true,
          typedefs: false,
          ignoreTypeReferences: true,
        },
      ],
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
      // `==`/`!=` triggers JS coercion (`null == undefined` → true,
      // `"" == 0` → true). `smart` keeps the `x == null` idiom (covers
      // both null and undefined in one check) so existing
      // null-or-undefined guards don't all need to be rewritten.
      // #921.
      eqeqeq: ["error", "smart"],
      "no-throw-literal": "error",
      "no-implicit-coercion": ["error", { boolean: true, number: true, string: true, disallowTemplateShorthand: false }],
      "no-unneeded-ternary": ["error", { defaultAssignment: false }],
      "no-else-return": ["error", { allowElseIf: false }],
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-dynamic-delete": "warn",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-useless-empty-export": "error",
      "@typescript-eslint/method-signature-style": ["error", "property"],
      "default-case-last": "error",
      "prefer-template": "error",
      "prefer-arrow-callback": "error",
      "arrow-body-style": ["error", "as-needed"],
      "no-multi-assign": "error",
      "prefer-rest-params": "error",
      "prefer-spread": "error",
      "no-self-compare": "error",
      "no-unmodified-loop-condition": "error",
      "no-constructor-return": "error",
      "import/no-duplicates": "error",
      "array-callback-return": "error",
      "default-param-last": "error",
      "no-new-wrappers": "error",
      "no-octal-escape": "error",
      "no-proto": "error",
      "no-script-url": "error",
      "no-useless-call": "error",
      "no-useless-concat": "error",
      "no-useless-rename": "error",
      radix: "error",
      "prefer-object-spread": "error",
      "prefer-numeric-literals": "error",
      "prefer-promise-reject-errors": "error",
      "no-lonely-if": "error",
      "no-floating-decimal": "error",
      "no-unused-private-class-members": "error",
      // `require-await` (and the type-checked variant) misfires on
      // Playwright route handlers, Express middleware, and any
      // framework-imposed async contract that returns a Promise
      // without `await`-ing inside. Off — signal-to-noise too low
      // without type information.
      "require-await": "off",
      "no-loop-func": "error",
      "no-new": "error",
      "no-undef-init": "error",
      "no-useless-return": "error",
      "prefer-regex-literals": "error",
      "prefer-exponentiation-operator": "error",
      "@typescript-eslint/consistent-type-assertions": "error",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/prefer-enum-initializers": "error",
      "import/first": "error",
      "import/newline-after-import": "error",
      "import/no-anonymous-default-export": "error",
      "import/no-mutable-exports": "error",
      "import/no-self-import": "error",
      "import/no-useless-path-segments": "error",
      "consistent-return": "warn",
      "class-methods-use-this": "warn",
      "prefer-destructuring": "warn",
      complexity: ["warn", { max: 15 }],
      "max-depth": ["warn", { max: 4 }],
      "max-params": ["warn", { max: 6 }],
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
      // The rule has no depth option — it flags any nested ternary.
      // In practice most of our `a ? b : c ? d : e` chains are clean
      // option tables, not obfuscation. Disable rather than warn.
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
      "sonarjs/cors": "off",
      // ── eslint-plugin-security tuning ──────────────────────────
      // Three high-volume rules are disabled because they fire on
      // patterns that are normal in this codebase, drowning the
      // signal-rich rules:
      //   - detect-non-literal-fs-filename: every workspace-aware
      //     `fs.readFile(WORKSPACE_PATHS.foo)` looks "non-literal"
      //     to the rule. WORKSPACE_PATHS is a static constants table,
      //     not user input. Keeping this on produced 527 warnings
      //     and 0 actionable findings on first audit.
      //   - detect-object-injection: any `obj[key]` with a dynamic
      //     key trips it (incl. `arr[i]`, locale-keyed message maps).
      //     Famously high-FP; SonarJS covers the real cases via
      //     `sonarjs/no-built-in-shadow` etc. 329 warnings / 0
      //     actionable on first audit.
      //   - detect-non-literal-regexp: e2e tests build regexps from
      //     testid prefixes — controlled inputs, not attacker-supplied.
      //     27 warnings / 0 actionable.
      // The remaining rules (detect-eval-with-expression, detect-
      // child-process, detect-unsafe-regex, detect-possible-timing-
      // attacks, detect-non-literal-require, detect-pseudoRandomBytes,
      // detect-buffer-noassert, detect-disable-mustache-escape,
      // detect-no-csrf-before-method-override, detect-bidi-characters,
      // detect-new-buffer) stay as warnings — tripwires for future
      // additions, audited at PR review time.
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-object-injection": "off",
      "security/detect-non-literal-regexp": "off",
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
      // MCP smoke test spawns tsx subprocess — safe in test context.
      "sonarjs/os-command": "off",
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
      "vue/no-useless-mustaches": "error",
      "vue/no-useless-v-bind": "error",
      "vue/prefer-true-attribute-shorthand": "error",
      "vue/no-empty-component-block": "error",
    },
  },
  eslintConfigPrettier,
];
