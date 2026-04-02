import type { Meta, StoryObj } from '@storybook/html';
import { renderReviewStep } from './stepReviewSubmit';

const meta: Meta = {
  title: 'Sanctioning/Steps/ReviewSubmit',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Step 3 of the sanctioning wizard. Displays a read-only summary of the application with validation warnings and save/submit buttons.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const Complete: Story = {
  render: () => {
    const container = document.createElement('div');
    container.style.cssText = 'padding: 20px; max-width: 900px;';
    renderReviewStep(container, {
      formData: {
        tournamentName: 'Cary Open 2027',
        proposedStartDate: '2027-06-01',
        proposedEndDate: '2027-06-07',
        hostCountryCode: 'USA',
        surfaceCategory: 'HARD',
        indoorOutdoor: 'OUTDOOR',
        sanctioningLevel: 'Level 3',
        governingBodyId: 'usta',
        applicant: {
          organisationName: 'Cary Tennis Park',
          contactName: 'Jane Doe',
          contactEmail: 'jane@carytennis.com',
        },
        events: [
          { eventName: "Men's Singles", eventType: 'SINGLES', gender: 'MALE', drawSize: 32 },
          { eventName: "Women's Singles", eventType: 'SINGLES', gender: 'FEMALE', drawSize: 32 },
        ],
      },
    });
    return container;
  },
};

export const Incomplete: Story = {
  render: () => {
    const container = document.createElement('div');
    container.style.cssText = 'padding: 20px; max-width: 900px;';
    renderReviewStep(container, {
      formData: {
        tournamentName: '',
        proposedStartDate: '2027-06-01',
        proposedEndDate: '',
        hostCountryCode: '',
        surfaceCategory: '',
        indoorOutdoor: '',
        sanctioningLevel: '',
        governingBodyId: '',
        applicant: { organisationName: '', contactName: '', contactEmail: '' },
        events: [],
      },
    });
    return container;
  },
};
