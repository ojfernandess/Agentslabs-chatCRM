/// <reference types="vite/client" />

declare module "nvoip-web-sdk/dist/nvoip-auth-widget.js";

interface ImportMetaEnv {
  readonly VITE_PUBLIC_ASSETS_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
