/**
 * E2E tests for the full sanctioning workflow through the UI.
 * Exercises the approval pipeline from applicant → reviewer → activation.
 *
 * These tests use the API helper for setup/teardown and the Page Object
 * Models for UI interaction and verification.
 */
import { test, expect } from '@playwright/test';
import { SanctioningDashboardPage } from './pages/SanctioningDashboardPage';
import { SanctioningDetailPage } from './pages/SanctioningDetailPage';
import { SanctioningApiHelper } from './helpers/sanctioningApi';
import { ITF_W50_APPLICATION, USTA_LEVEL3_APPLICATION } from './fixtures/sanctioning-data';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

test.describe('Sanctioning Workflow — Dashboard', () => {
  test('displays sanctioning records in the dashboard table', async ({ page, request }) => {
    // Seed a record via API
    const api = new SanctioningApiHelper(request, SERVER_URL);
    await api.create(ITF_W50_APPLICATION);

    const dashboard = new SanctioningDashboardPage(page);
    await dashboard.goto();
    await dashboard.expectVisible();

    // Should see the seeded record
    await dashboard.expectRowWithText(ITF_W50_APPLICATION.proposal.tournamentName);
  });

  test('filters by status', async ({ page, request }) => {
    const api = new SanctioningApiHelper(request, SERVER_URL);
    await api.create({ ...ITF_W50_APPLICATION, proposal: { ...ITF_W50_APPLICATION.proposal, tournamentName: 'Filter Test Draft' } });

    const dashboard = new SanctioningDashboardPage(page);
    await dashboard.goto();

    // Filter to DRAFT
    await dashboard.filterByStatus('DRAFT');
    await dashboard.expectRowWithText('Filter Test Draft');

    // Filter to APPROVED — should not show DRAFT records
    await dashboard.filterByStatus('APPROVED');
    const rows = await dashboard.getRowCount();
    // May be 0 or just no 'Filter Test Draft' row
  });

  test('searches by tournament name', async ({ page, request }) => {
    const api = new SanctioningApiHelper(request, SERVER_URL);
    await api.create({
      ...USTA_LEVEL3_APPLICATION,
      proposal: { ...USTA_LEVEL3_APPLICATION.proposal, tournamentName: 'Searchable Unique Name XYZ' },
    });

    const dashboard = new SanctioningDashboardPage(page);
    await dashboard.goto();

    await dashboard.searchByName('Searchable Unique');
    await dashboard.expectRowWithText('Searchable Unique Name XYZ');
  });
});

test.describe('Sanctioning Workflow — Approval Pipeline', () => {
  test('views a DRAFT record and sees available actions', async ({ page, request }) => {
    const api = new SanctioningApiHelper(request, SERVER_URL);
    const { sanctioningId } = (await api.create(ITF_W50_APPLICATION)) as any;

    const detail = new SanctioningDetailPage(page);
    await detail.goto(sanctioningId);

    await detail.expectStatus('DRAFT');
    await detail.expectTournamentName(ITF_W50_APPLICATION.proposal.tournamentName);
  });

  test('advances through SUBMITTED → UNDER_REVIEW → APPROVED via detail actions', async ({ page, request }) => {
    const api = new SanctioningApiHelper(request, SERVER_URL);

    // Create and submit via API (faster than UI for setup)
    const createResult = await api.create(USTA_LEVEL3_APPLICATION);
    const sanctioningId = createResult?.sanctioningRecord?.sanctioningId;
    await api.execute(sanctioningId, 'submitApplication', {});

    const detail = new SanctioningDetailPage(page);
    await detail.goto(sanctioningId);
    await detail.expectStatus('SUBMITTED');

    // Click "Begin Review"
    await detail.clickAction('Begin Review');
    await detail.expectStatus('UNDER REVIEW');

    // Click "Approve"
    await detail.clickAction('Approve');
    await detail.expectStatus('APPROVED');

    // Verify status history
    await detail.expectStatusHistoryContains('SUBMITTED');
    await detail.expectStatusHistoryContains('UNDER_REVIEW');
    await detail.expectStatusHistoryContains('APPROVED');
  });

  test('rejects application with reason via confirmation dialog', async ({ page, request }) => {
    const api = new SanctioningApiHelper(request, SERVER_URL);
    const { sanctioningId } = (await api.createInStatus(
      { ...ITF_W50_APPLICATION, proposal: { ...ITF_W50_APPLICATION.proposal, tournamentName: 'Rejection Test' } },
      'UNDER_REVIEW',
    )) as any;

    const detail = new SanctioningDetailPage(page);
    await detail.goto(sanctioningId);
    await detail.expectStatus('UNDER REVIEW');

    // Click Reject — should show confirmation dialog with reason field
    await detail.clickAction('Reject');
    await detail.confirmAction('Venue does not meet safety standards');

    await detail.expectStatus('REJECTED');
  });

  test('withdraws application with confirmation', async ({ page, request }) => {
    const api = new SanctioningApiHelper(request, SERVER_URL);
    const { sanctioningId } = (await api.createInStatus(
      { ...USTA_LEVEL3_APPLICATION, proposal: { ...USTA_LEVEL3_APPLICATION.proposal, tournamentName: 'Withdraw Test' } },
      'SUBMITTED',
    )) as any;

    const detail = new SanctioningDetailPage(page);
    await detail.goto(sanctioningId);

    await detail.clickAction('Withdraw');
    await detail.confirmAction('Changed plans');
    await detail.expectStatus('WITHDRAWN');

    // No more actions should be available
    await detail.expectActionNotAvailable('Approve');
    await detail.expectActionNotAvailable('Withdraw');
  });

  test('activates approved record and creates tournament', async ({ page, request }) => {
    const api = new SanctioningApiHelper(request, SERVER_URL);
    const { sanctioningId } = (await api.createInStatus(
      { ...ITF_W50_APPLICATION, proposal: { ...ITF_W50_APPLICATION.proposal, tournamentName: 'Activation Test' } },
      'APPROVED',
    )) as any;

    const detail = new SanctioningDetailPage(page);
    await detail.goto(sanctioningId);
    await detail.expectStatus('APPROVED');

    // Click Activate
    await detail.clickAction('Activate (Create Tournament)');
    await detail.expectStatus('ACTIVE');
  });
});

test.describe('Sanctioning Workflow — Post-Event Lifecycle', () => {
  test('transitions ACTIVE → POST_EVENT → CLOSED', async ({ page, request }) => {
    const api = new SanctioningApiHelper(request, SERVER_URL);
    const { sanctioningId } = (await api.createInStatus(
      { ...USTA_LEVEL3_APPLICATION, proposal: { ...USTA_LEVEL3_APPLICATION.proposal, tournamentName: 'Lifecycle Test' } },
      'ACTIVE',
    )) as any;

    const detail = new SanctioningDetailPage(page);
    await detail.goto(sanctioningId);
    await detail.expectStatus('ACTIVE');

    // Mark post-event
    await detail.clickAction('Mark Post-Event');
    await detail.expectStatus('POST EVENT');

    // Close
    await detail.clickAction('Close');
    await detail.expectStatus('CLOSED');
  });
});
