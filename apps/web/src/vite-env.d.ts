/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_ASSETS_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
