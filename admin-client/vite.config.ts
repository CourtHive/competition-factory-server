import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/admin/',
  // Shim process.env.SERVER for the dev server. baseApi.ts reads it to
  // override the baseURL when admin-client runs on a different origin
  // than the NestJS server (e.g. e2e: vite on 5179, server on 3000).
  // Production builds usually serve admin-client/dist from the same
  // origin as the server so the fallback to window.location.origin is fine.
  define: {
    'process.env.SERVER': JSON.stringify(process.env.SERVER ?? ''),
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
