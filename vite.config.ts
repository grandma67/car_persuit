import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works under https://<user>.github.io/<repo>/
  base: './',
  build: {
    target: 'es2022',
    // Rapier embeds its WASM in the JS bundle (~2.5MB raw / ~0.9MB gzip) — expected.
    chunkSizeWarningLimit: 3000,
  },
});
