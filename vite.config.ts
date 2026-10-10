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
    },
  };
});
