/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_WEBCHAT_API_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
