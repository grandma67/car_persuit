/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works under https://<user>.github.io/<repo>/
  base: './',
  build: {
    target: 'es2022',
    // Rapier embeds its WASM in the JS bundle (~3.1MB raw / ~1.1MB gzip) — expected.
    chunkSizeWarningLimit: 3500,
  },
  test: {
    // Several tests generate whole cities; the 5s default is too tight on slow or busy machines.
    testTimeout: 20_000,
  },
});
