import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { localHosting } from './dev/local-hosting';

// Loaded with `--configLoader runner` (package.json scripts) so this config can import the TypeScript
// workspace package @roofing-crm/shared, which the default bundling loader would hand to Node as-is.
const basemapDir = fileURLToPath(new URL('../../basemap', import.meta.url));
// The pipeline deployment the CRM calls; PIPELINE_API_BASE in the shell overrides it (a local pipeline).
const pin = JSON.parse(
  readFileSync(new URL('../../packages/pipeline-client/openapi.pin.json', import.meta.url), 'utf8'),
) as { apiBase?: string };

export default defineConfig({
  plugins: [
    react(),
    localHosting({
      basemapDir,
      pipelineApiBase: process.env.PIPELINE_API_BASE ?? pin.apiBase,
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    // MapLibre alone is about 1 MB minified; it gets its own long-cached chunk.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      onwarn(warning, warn) {
        // Comment annotations Rollup cannot place in third-party code are dropped harmlessly.
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/node_modules/')) return;
        warn(warning);
      },
      output: {
        manualChunks: { maplibre: ['maplibre-gl'] },
        // MapLibre's module worker is emitted as an asset (src/map/maplibre-setup.ts). A .js name makes
        // S3 serve it as JavaScript; module workers refuse any other content type.
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.mjs'))
            ? 'assets/[name]-[hash].js'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
});
