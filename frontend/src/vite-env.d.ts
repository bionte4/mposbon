/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_DEPLOYMENT_MODE: 'cloud' | 'onprem';
  readonly VITE_DEFAULT_TENANT_SLUG: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
