import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Injects the list of built assets into public/sw.js so the whole IDE works offline after first load. */
function swPrecache() {
  return {
    name: 'cstudio-sw-precache',
    apply: 'build' as const,
    writeBundle(opts: { dir?: string }, bundle: Record<string, unknown>) {
      const dir = opts.dir ?? 'dist';
      const assets = Object.keys(bundle).filter((f) => /\.(js|css|woff2?|ttf)$/.test(f)).map((f) => './' + f);
      const swPath = join(dir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8')
        .replace('const ASSETS = []; /*__PRECACHE__*/', `const ASSETS = ${JSON.stringify(assets)};`)
        .replace('__BUILD__', Date.now().toString(36));
      writeFileSync(swPath, sw);
    },
  };
}

const backend = process.env.CSTUDIO_BACKEND ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), swPrecache()],
  base: './',
  server: {
    host: true,
    proxy: {
      '/api': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: { monaco: ['monaco-editor/esm/vs/editor/edcore.main.js'] },
      },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@yowasp/clang'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
} as import('vite').UserConfig);
