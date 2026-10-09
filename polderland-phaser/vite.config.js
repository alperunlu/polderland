import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // A classic script rather than an ES module: the iOS build runs the
        // game from a string in a WebView, where the document has an opaque
        // origin and module scripts are not reliably allowed.
        format: 'iife',
        entryFileNames: 'assets/polderland.js',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
});
