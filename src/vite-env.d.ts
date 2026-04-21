/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCALE?: "en" | "ja";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
