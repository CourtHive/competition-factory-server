import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
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
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
});
