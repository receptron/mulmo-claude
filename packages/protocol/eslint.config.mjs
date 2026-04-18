import eslintBase from "../../config/eslint.packages.mjs";

export default [
  { files: ["{src,test}/**/*.ts"] },
  { ignores: ["dist/**/*"] },
  ...eslintBase,
];
