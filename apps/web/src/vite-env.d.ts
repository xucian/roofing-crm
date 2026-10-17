/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Short git commit the bundle was built from, set by the deploy script ("-dirty" when the tree had changes). */
  readonly VITE_BUILD_COMMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
