import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tabulator — the panels create Tabulator instances directly.
// We capture constructor args to verify columns and data mapping.
const tabulatorInstances: any[] = [];
const mockOn = vi.fn();
const mockDestroy = vi.fn();

vi.mock('tabulator-tables', () => {
  class MockTabulator {
    options: any;
    constructor(_el: any, options: any) {
      this.options = options;
      tabulatorInstances.push(this);
    }
    on = mockOn;
    destroy = mockDestroy;
    static findTable = vi.fn().mockReturnValue([]);
  }
  return { TabulatorFull: MockTabulator };
});

// Mock courthive-components for inviteModal dependency
vi.mock('courthive-components', () => ({
  validators: { emailValidator: vi.fn() },
  renderForm: vi.fn(),
}));

// Mock services that hit the network or show UI
vi.mock('services/apis/servicesApi', () => ({
  removeUser: vi.fn().mockResolvedValue({}),
}));
vi.mock('services/notifications/tmxToast', () => ({
  tmxToast: vi.fn(),
}));
vi.mock('services/dom/copyClick', () => ({
  copyClick: vi.fn(),
}));
vi.mock('services/provider/providerState', () => ({
  setActiveProvider: vi.fn(),
  clearActiveProvider: vi.fn(),
}));
vi.mock('components/modals/baseModal/baseModal', () => ({
  openModal: vi.fn(),
  confirmModal: vi.fn(),
}));
vi.mock('components/modals/editProvider', () => ({
  editProviderModal: vi.fn(),
}));
vi.mock('components/modals/editUserModal', () => ({
  editUserModal: vi.fn(),
}));
vi.mock('components/modals/inviteUser', () => ({
  inviteModal: vi.fn(),
}));
vi.mock('services/authentication/authApi', () => ({
  inviteUser: vi.fn().mockResolvedValue({}),
}));

import { renderProvidersPanel } from './providersPanel';
import { renderUsersPanel } from './usersPanel';

const MOCK_PROVIDERS = [
  {
    key: 'org-1',
    value: {
      organisationName: 'Tennis Australia',
      organisationAbbreviation: 'TA',
      organisationId: 'org-1',
      lastAccess: '2026-04-15T10:30:00Z',
    },
  },
  {
    key: 'org-2',
    value: {
      organisationName: 'USTA',
      organisationAbbreviation: 'USTA',
      organisationId: 'org-2',
    },
  },
];

const MOCK_USERS = [
  {
    key: 'u-1',
    value: {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@test.com',
      providerId: 'org-1',
      roles: ['admin', 'client'],
      lastAccess: '2026-04-18T14:00:00Z',
    },
  },
  {
    key: 'u-2',
    value: {
      firstName: 'Bob',
      lastName: 'Smith',
      email: 'bob@test.com',
      providerId: 'org-2',
      roles: ['client'],
    },
  },
];

describe('renderProvidersPanel', () => {
  let container: HTMLElement;

  beforeEach(() => {
    tabulatorInstances.length = 0;
    mockOn.mockReset();
    container = document.createElement('div');
  });

  it('renders toolbar with search input and create button', () => {
    renderProvidersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const searchInput = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    const createBtn = container.querySelector('.btn-invite');
    expect(createBtn).toBeTruthy();
  });

  it('renders provider list layout with two panes', () => {
    renderProvidersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    expect(container.querySelector('.system-providers-layout')).toBeTruthy();
    expect(container.querySelector('.system-provider-list')).toBeTruthy();
    expect(container.querySelector('.system-provider-detail')).toBeTruthy();
  });

  it('creates Tabulator with correct provider data including lastAccess', () => {
    renderProvidersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const tableInstance = tabulatorInstances[0];
    expect(tableInstance).toBeTruthy();

    const data = tableInstance.options.data;
    expect(data).toHaveLength(2);
    expect(data[0].organisationName).toBe('Tennis Australia');
    expect(data[0].lastAccess).toBe('2026-04-15T10:30:00Z');
    expect(data[1].lastAccess).toBe('');
  });

  it('includes lastAccess column in provider list table', () => {
    renderProvidersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const columns = tabulatorInstances[0].options.columns;
    const lastAccessCol = columns.find((c) => c.field === 'lastAccess');
    expect(lastAccessCol).toBeTruthy();
    expect(lastAccessCol.headerSort).toBe(true);
  });

  it('lastAccess formatter returns empty string for falsy values', () => {
    renderProvidersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const columns = tabulatorInstances[0].options.columns;
    const lastAccessCol = columns.find((c) => c.field === 'lastAccess');
    const result = lastAccessCol.formatter({ getValue: () => '' });
    expect(result).toBe('');
  });

  it('lastAccess formatter returns formatted date for valid values', () => {
    renderProvidersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const columns = tabulatorInstances[0].options.columns;
    const lastAccessCol = columns.find((c) => c.field === 'lastAccess');
    const result = lastAccessCol.formatter({ getValue: () => '2026-04-15T10:30:00Z' });
    expect(result).toContain('2026');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles empty providers array', () => {
    renderProvidersPanel({ container, providers: [], users: MOCK_USERS, onRefresh: vi.fn() });
    const tableInstance = tabulatorInstances[0];
    expect(tableInstance.options.data).toHaveLength(0);
  });
});

describe('renderUsersPanel', () => {
  let container: HTMLElement;

  beforeEach(() => {
    tabulatorInstances.length = 0;
    container = document.createElement('div');
  });

  it('renders toolbar with search, invite, edit, and remove buttons', () => {
    renderUsersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const searchInput = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    expect(container.querySelector('.btn-invite')).toBeTruthy();
    expect(container.querySelector('.btn-edit')).toBeTruthy();
    expect(container.querySelector('.btn-remove')).toBeTruthy();
  });

  it('creates Tabulator with correct user data including lastAccess', () => {
    renderUsersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const tableInstance = tabulatorInstances[0];
    const data = tableInstance.options.data;
    expect(data).toHaveLength(2);
    expect(data[0].firstName).toBe('Jane');
    expect(data[0].lastAccess).toBe('2026-04-18T14:00:00Z');
    expect(data[0].providerName).toBe('Tennis Australia');
    expect(data[1].lastAccess).toBe('');
    expect(data[1].providerName).toBe('USTA');
  });

  it('maps provider IDs to names via lookup', () => {
    renderUsersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const data = tabulatorInstances[0].options.data;
    expect(data[0].providerName).toBe('Tennis Australia');
    expect(data[1].providerName).toBe('USTA');
  });

  it('includes lastAccess column in users table', () => {
    renderUsersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const columns = tabulatorInstances[0].options.columns;
    const lastAccessCol = columns.find((c) => c.field === 'lastAccess');
    expect(lastAccessCol).toBeTruthy();
    expect(lastAccessCol.headerSort).toBe(true);
  });

  it('lastAccess formatter returns empty string for missing values', () => {
    renderUsersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const columns = tabulatorInstances[0].options.columns;
    const lastAccessCol = columns.find((c) => c.field === 'lastAccess');
    expect(lastAccessCol.formatter({ getValue: () => '' })).toBe('');
  });

  it('lastAccess formatter formats valid dates', () => {
    renderUsersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const columns = tabulatorInstances[0].options.columns;
    const lastAccessCol = columns.find((c) => c.field === 'lastAccess');
    const result = lastAccessCol.formatter({ getValue: () => '2026-04-18T14:00:00Z' });
    expect(result).toContain('2026');
  });

  it('includes all expected columns', () => {
    renderUsersPanel({ container, providers: MOCK_PROVIDERS, users: MOCK_USERS, onRefresh: vi.fn() });
    const fields = tabulatorInstances[0].options.columns.map((c) => c.field);
    expect(fields).toEqual(['firstName', 'lastName', 'email', 'providerName', 'roles', 'lastAccess']);
  });

  it('handles empty users array', () => {
    renderUsersPanel({ container, providers: MOCK_PROVIDERS, users: [], onRefresh: vi.fn() });
    expect(tabulatorInstances[0].options.data).toHaveLength(0);
  });
});
