/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // `npm run dev:https`: HTTPS on the LAN with a self-signed certificate, so a phone gets a secure
  // page (tilt steering needs one). Plain http stays the default: the browser checks use it.
  plugins: mode === 'https' ? [basicSsl()] : [],
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
}));
