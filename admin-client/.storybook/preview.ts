import type { Preview } from '@storybook/html';
import '../src/styles/theme.css';
import '../src/styles/admin.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      values: [
        { name: 'Light', value: '#ffffff' },
        { name: 'Dark', value: '#1a1a2e' },
      ],
    },
  },
};

export default preview;
