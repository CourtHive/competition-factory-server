import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/admin/',
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
