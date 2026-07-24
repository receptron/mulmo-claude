// `.vue` module shim for the plain-TypeScript consumers of this program —
// ESLint's type-aware rules run through `@typescript-eslint/parser`, which
// builds a stock `tsc` program with no Vue language plugin, so every SFC
// import resolves to nothing and lands as implicit `any`. That `any` then
// flows through `wrapWithScope`'s generic into each plugin's registration
// object, which is what `no-unsafe-assignment` was reporting across
// `src/plugins/*/index.ts`.
//
// vue-tsc (the real `yarn typecheck` / build) resolves the SFC itself, and an
// actual module always outranks a wildcard ambient declaration — so this
// narrows nothing there. Mirrors `test/shims.d.ts`, which exists for the same
// reason under `tsc -p test/tsconfig.json`.

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
