import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';
import brandImage from './CourtHive.svg';

const prefersDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;

const theme = create({
  base: prefersDark ? 'dark' : 'light',
  brandTitle: 'Competition Factory Server',
  brandUrl: 'https://github.com/CourtHive/competition-factory-server',
  brandImage,
});

addons.setConfig({
  theme,
});
