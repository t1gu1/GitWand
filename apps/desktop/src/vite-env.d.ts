/// <reference types="vite/client" />

declare module "@tauri-apps/plugin-process" {
  /** Restart the app immediately. */
  export function relaunch(): Promise<void>;
  /** Exit the app with the given exit code. */
  export function exit(code?: number): Promise<void>;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

/** App version injected at build time from package.json via vite.config.ts `define`. */
declare const __APP_VERSION__: string;
