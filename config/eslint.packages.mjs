// Shared ESLint config for @mulmobridge/* packages.
// Each package extends this with its own eslint.config.mjs.

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import sonarjs from "eslint-plugin-sonarjs";

export default [
  eslint.configs.recommended,
  sonarjs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { prettier: prettierPlugin },
    rules: {
      "prettier/prettier": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^__", varsIgnorePattern: "^__" },
      ],
    },
  },
  eslintConfigPrettier,
];
