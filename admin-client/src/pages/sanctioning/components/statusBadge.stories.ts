import type { Meta, StoryObj } from '@storybook/html';
import { createStatusBadge } from './statusBadge';

const meta: Meta = {
  title: 'Sanctioning/StatusBadge',
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: [
        'DRAFT',
        'SUBMITTED',
        'UNDER_REVIEW',
        'APPROVED',
        'CONDITIONALLY_APPROVED',
        'REJECTED',
        'WITHDRAWN',
        'MODIFICATION_REQUESTED',
        'ACTIVE',
        'POST_EVENT',
        'CLOSED',
        'ISSUES_FLAGGED',
      ],
      description: 'Sanctioning workflow status',
    },
  },
  render: (args: any) => createStatusBadge(args.status),
};

export default meta;
type Story = StoryObj;

export const Draft: Story = { args: { status: 'DRAFT' } };
export const Submitted: Story = { args: { status: 'SUBMITTED' } };
export const UnderReview: Story = { args: { status: 'UNDER_REVIEW' } };
export const Approved: Story = { args: { status: 'APPROVED' } };
export const ConditionallyApproved: Story = { args: { status: 'CONDITIONALLY_APPROVED' } };
export const Rejected: Story = { args: { status: 'REJECTED' } };
export const Withdrawn: Story = { args: { status: 'WITHDRAWN' } };
export const ModificationRequested: Story = { args: { status: 'MODIFICATION_REQUESTED' } };
export const Active: Story = { args: { status: 'ACTIVE' } };
export const PostEvent: Story = { args: { status: 'POST_EVENT' } };
export const Closed: Story = { args: { status: 'CLOSED' } };
export const IssuesFlagged: Story = { args: { status: 'ISSUES_FLAGGED' } };

export const AllStatuses: Story = {
  render: () => {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; padding: 16px;';

    const statuses = [
      'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'CONDITIONALLY_APPROVED',
      'REJECTED', 'WITHDRAWN', 'MODIFICATION_REQUESTED', 'ACTIVE', 'POST_EVENT',
      'CLOSED', 'ISSUES_FLAGGED',
    ];

    for (const status of statuses) {
      container.appendChild(createStatusBadge(status));
    }

    return container;
  },
};
