import type { StorybookConfig } from '@storybook/html-vite';

const config: StorybookConfig = {
  stories: ['../src/stories/**/*.mdx', '../src/stories/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/html-vite',
    options: {},
  },
  viteFinal: async (config) => {
    // Set base path for GitHub Pages deployment
    if (process.env.NODE_ENV === 'production') {
      config.base = '/competition-factory-server/';

      if (!config.build) config.build = {};
      if (!config.build.rollupOptions) config.build.rollupOptions = {};

      config.build.rollupOptions.output = {
        manualChunks: () => 'everything.js',
        inlineDynamicImports: false,
      };

      config.build.chunkSizeWarningLimit = 5000;
    }
    return config;
  },
};
export default config;
