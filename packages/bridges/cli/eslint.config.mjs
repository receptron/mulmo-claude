import eslintBase from "../../../config/eslint.packages.mjs";

const packageTsFiles = ["{src,test}/**/*.ts"];

export default [
  { ignores: ["dist/**/*"] },
  ...eslintBase.map((config) => ({
    ...config,
    files: packageTsFiles,
  })),
];
