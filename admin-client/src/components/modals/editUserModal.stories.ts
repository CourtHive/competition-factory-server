import { Meta, StoryObj } from '@storybook/html';
import { buildRecoveryEmailStatus } from './editUserModal';

const meta: Meta = {
  title: 'Modals/EditUserModal/RecoveryEmailStatus',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Status row that appears under the Recovery email input in the Edit User modal. Three states drive the badge style and whether the Send-verification button renders: no recovery email set, set-but-unverified, and verified.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const NoRecoveryEmail: Story = {
  render: () => buildRecoveryEmailStatus({
    email: 'rooby@courthive.com',
    contactEmail: null,
    emailVerifiedAt: null,
  }),
};

export const Unverified: Story = {
  render: () => buildRecoveryEmailStatus({
    email: 'rooby@courthive.com',
    contactEmail: 'charles@courthive.com',
    emailVerifiedAt: null,
  }),
};

export const Verified: Story = {
  render: () => buildRecoveryEmailStatus({
    email: 'rooby@courthive.com',
    contactEmail: 'charles@courthive.com',
    emailVerifiedAt: '2026-05-28T19:16:37Z',
  }),
};

export const AllThree: Story = {
  render: () => {
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:16px;padding:16px;';
    [
      { label: 'No recovery email', user: { email: 'a@b', contactEmail: null, emailVerifiedAt: null } },
      { label: 'Unverified', user: { email: 'a@b', contactEmail: 'charles@courthive.com', emailVerifiedAt: null } },
      { label: 'Verified', user: { email: 'a@b', contactEmail: 'charles@courthive.com', emailVerifiedAt: '2026-05-28T19:16:37Z' } },
    ].forEach(({ label, user }) => {
      const wrap = document.createElement('div');
      const title = document.createElement('div');
      title.style.cssText = 'font-size:12px;color:var(--tmx-text-muted);margin-bottom:4px;';
      title.textContent = label;
      wrap.append(title, buildRecoveryEmailStatus(user));
      root.appendChild(wrap);
    });
    return root;
  },
};
