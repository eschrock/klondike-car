import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build`                → static site in dist/ (relative base, works on GitHub Pages)
// `vite build --mode single`  → one self-contained dist-single/index.html
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      chunkSizeWarningLimit: 5000,
    },
    test: {
      include: ['src/**/*.test.ts'],
      // The analysis (cargo-capacity and rider sweeps) makes many single tests take 1-2 s locally and 5-7 s on the shared CI runners (2-3x slower);
      // the default 5 s limit flaked the Pages deploy. Heavy sweeps still set their own longer limits.
      testTimeout: 30000,
    },
  };
});
