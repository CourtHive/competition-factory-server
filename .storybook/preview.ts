import type { Preview } from '@storybook/html-vite';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Color theme',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  decorators: [
    (storyFn, context) => {
      const theme = context.globals.theme || 'light';
      document.body.style.backgroundColor = theme === 'dark' ? '#1a1a2e' : '#ffffff';
      document.body.style.color = theme === 'dark' ? '#e0e0e0' : '#363636';
      document.body.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      document.body.style.lineHeight = '1.6';
      return storyFn();
    },
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
