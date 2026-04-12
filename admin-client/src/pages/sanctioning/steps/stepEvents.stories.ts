import type { Meta, StoryObj } from '@storybook/html';
import { renderEventsStep } from './stepEvents';

const meta: Meta = {
  title: 'Sanctioning/Steps/Events',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Step 2 of the sanctioning wizard. Displays a table of proposed events with add/remove functionality via modal dialogs.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const NoEvents: Story = {
  render: () => {
    const container = document.createElement('div');
    container.style.cssText = 'padding: 20px; max-width: 900px;';
    renderEventsStep(container, {
      formData: { events: [] },
    });
    return container;
  },
};

export const WithEvents: Story = {
  render: () => {
    const container = document.createElement('div');
    container.style.cssText = 'padding: 20px; max-width: 900px;';
    renderEventsStep(container, {
      formData: {
        events: [
          {
            eventName: "Men's Singles",
            eventType: 'SINGLES',
            gender: 'MALE',
            drawSize: 32,
            drawType: 'SINGLE_ELIMINATION',
            matchUpFormat: 'SET3-S:6/TB7',
          },
          {
            eventName: "Women's Singles",
            eventType: 'SINGLES',
            gender: 'FEMALE',
            drawSize: 32,
            drawType: 'SINGLE_ELIMINATION',
            matchUpFormat: 'SET3-S:6/TB7',
          },
          {
            eventName: "Men's Doubles",
            eventType: 'DOUBLES',
            gender: 'MALE',
            drawSize: 16,
            drawType: 'SINGLE_ELIMINATION',
          },
        ],
      },
    });
    return container;
  },
};
