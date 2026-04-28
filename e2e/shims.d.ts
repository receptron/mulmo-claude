// Minimal module shims so `tsc -p e2e/tsconfig.json` can follow
// transitive imports that reach `src/plugins/**/index.ts` (which
// re-export `.vue` components). Duplicated from test/shims.d.ts —
// e2e and test are independent projects, each opting into their own
// shim surface.

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

declare module "*.css";
declare module "*.scss";
declare module "material-icons/iconfont/material-icons.css";

interface ImportMeta {
  glob: (pattern: string | readonly string[], options?: { eager?: boolean }) => Record<string, unknown>;
}
