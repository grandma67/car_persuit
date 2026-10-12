/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works under https://<user>.github.io/<repo>/
  base: './',
  build: {
    target: 'es2022',
    // Rapier embeds its WASM in the JS bundle (~2.5MB raw / ~0.9MB gzip) — expected.
    chunkSizeWarningLimit: 3000,
  },
  test: {
    // Several tests generate whole cities; the 5s default is too tight on slow or busy machines.
    testTimeout: 20_000,
  },
});
