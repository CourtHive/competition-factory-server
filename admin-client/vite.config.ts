import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { resolve } from 'path';

// Capture the build commit + timestamp so the running app can announce
// itself in the browser console. Lets a dev verify "did my rebuild
// actually ship" without poking around in DevTools.
const BUILD_COMMIT = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
})();
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  base: '/admin/',
  // Shim process.env.SERVER for the dev server. baseApi.ts reads it to
  // override the baseURL when admin-client runs on a different origin
  // than the NestJS server (e.g. e2e: vite on 5179, server on 3000).
  // Production builds usually serve admin-client/dist from the same
  // origin as the server so the fallback to window.location.origin is fine.
  define: {
    'process.env.SERVER': JSON.stringify(process.env.SERVER ?? ''),
    __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  resolve: {
    alias: {
      // Mirror TMX absolute import paths
      components: resolve(__dirname, 'src/components'),
      services: resolve(__dirname, 'src/services'),
      pages: resolve(__dirname, 'src/pages'),
      functions: resolve(__dirname, 'src/functions'),
      constants: resolve(__dirname, 'src/constants'),
      config: resolve(__dirname, 'src/config'),
      settings: resolve(__dirname, 'src/settings'),
      styles: resolve(__dirname, 'src/styles'),
      router: resolve(__dirname, 'src/router'),
      types: resolve(__dirname, 'src/types'),
      i18n: resolve(__dirname, 'src/i18n'),
    },
  },
  build: {
    outDir: 'dist',
  },
});
