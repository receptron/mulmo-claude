import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import sonarjs from "eslint-plugin-sonarjs";
import importPlugin from "eslint-plugin-import";

export default [
  {
    files: ["{src,test}/**/*.{js,ts,yaml,yml}", "assets/html/js/**/*.js"],
  },
  {
    ignores: ["lib", "src/plugins/spreadsheet/engine"],
  },
  eslint.configs.recommended,
  sonarjs.configs.recommended,
  ...tseslint.configs.recommended,
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
      "sonarjs/redundant-type-aliases": "off",
      "sonarjs/todo-tag": "off",
      "sonarjs/no-commented-code": "off",
      "sonarjs/no-unused-vars": "warn",
      "sonarjs/no-nested-conditional": "off",
      "sonarjs/cognitive-complexity": "error",
      // MulmoClaude is a local desktop app — spawning claude/docker/git
      // via PATH is normal operation, not a server-side injection risk.
      "sonarjs/no-os-command-from-path": "off",
      "sonarjs/cors": "off",
      "sonarjs/pseudo-random": "warn",
    },
    plugins: {
      prettier: prettierPlugin,
      import: importPlugin,
    },
  },
  eslintConfigPrettier,
];
