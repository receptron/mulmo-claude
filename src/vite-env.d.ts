/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCALE?: "en" | "ja";
  // Mirrored from `DEV_MODE` by vite.config.ts. "1" enables the
  // Debug role; anything else is off. Read by `useSystemConfig` as
  // the initial value before the runtime endpoint confirms.
  readonly VITE_DEV_MODE?: "1" | "0";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
