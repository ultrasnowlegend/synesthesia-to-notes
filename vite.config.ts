import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

/**
 * Aplikace je jen slupka nad knihovnou v src/. Hlavni proces si ji importuje
 * primo ze zdroju, takze jedna zmena v jadru se projevi i v okne bez toho, aby
 * se knihovna musela zvlast prekladat.
 */
export default defineConfig({
  root: 'app',
  base: './',
  build: { outDir: '../dist-app', emptyOutDir: true },
  resolve: { alias: { '@': fileURLToPath(new URL('./app/src', import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: '../dist-electron',
            rollupOptions: { external: ['electron', 'verovio/wasm', 'verovio/esm'] },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart: (args) => args.reload(),
        vite: {
          build: {
            outDir: '../dist-electron',
            // Electron nacte predskript jako modul jen s priponou .mjs;
            // balicek je "type": "module", takze .js by skoncilo chybou.
            rollupOptions: { output: { entryFileNames: 'preload.mjs' } },
          },
        },
      },
    ]),
    renderer(),
  ],
});
