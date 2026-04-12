import type { Meta, StoryObj } from '@storybook/html';
import { renderBasicInfoStep } from './stepBasicInfo';

const meta: Meta = {
  title: 'Sanctioning/Steps/BasicInfo',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Step 1 of the sanctioning wizard. Captures tournament name, dates, location, surface, and applicant information.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const Empty: Story = {
  render: () => {
    const container = document.createElement('div');
    container.style.cssText = 'padding: 20px; max-width: 900px;';
    renderBasicInfoStep(container, {
      formData: {
        tournamentName: '',
        proposedStartDate: '',
        proposedEndDate: '',
        hostCountryCode: '',
        surfaceCategory: '',
        indoorOutdoor: '',
        sanctioningLevel: '',
        governingBodyId: '',
        applicant: { organisationName: '', contactName: '', contactEmail: '' },
      },
    });
    return container;
  },
};

export const Prefilled: Story = {
  render: () => {
    const container = document.createElement('div');
    container.style.cssText = 'padding: 20px; max-width: 900px;';
    renderBasicInfoStep(container, {
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
      },
    });
    return container;
  },
};
