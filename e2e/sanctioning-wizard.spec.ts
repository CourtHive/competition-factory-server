/**
 * E2E tests for the sanctioning application wizard.
 * Tests the multi-step form from the end-user perspective.
 */
import { test, expect } from '@playwright/test';
import { SanctioningDashboardPage } from './pages/SanctioningDashboardPage';
import { SanctioningWizardPage } from './pages/SanctioningWizardPage';
import { WIZARD_BASIC_INFO, WIZARD_EVENT } from './fixtures/sanctioning-data';

test.describe('Sanctioning Wizard', () => {
  test('navigates from dashboard to new application wizard', async ({ page }) => {
    const dashboard = new SanctioningDashboardPage(page);
    await dashboard.goto();
    await dashboard.expectVisible();
    await dashboard.clickNewApplication();

    // Should be on the wizard page
    await expect(page).toHaveURL(/sanctioning\/new/);
  });

  test('validates required fields before advancing from Step 1', async ({ page }) => {
    const wizard = new SanctioningWizardPage(page);
    await wizard.goto();

    // Try to advance with empty form — should show validation toast
    await wizard.clickNext();

    // Should still be on step 1 (not advance)
    await expect(page.getByText('Tournament Details')).toBeVisible();
  });

  test('fills Step 1 and advances to Step 2', async ({ page }) => {
    const wizard = new SanctioningWizardPage(page);
    await wizard.goto();

    await wizard.fillBasicInfo(WIZARD_BASIC_INFO);
    await wizard.clickNext();

    // Should be on Step 2 — Events
    await expect(page.getByText('Event Proposals')).toBeVisible();
  });

  test('validates at least one event required before advancing from Step 2', async ({ page }) => {
    const wizard = new SanctioningWizardPage(page);
    await wizard.goto();

    await wizard.fillBasicInfo(WIZARD_BASIC_INFO);
    await wizard.clickNext(); // → Step 2

    // Try to advance without adding events
    await wizard.clickNext();

    // Should still show events step
    await expect(page.getByText('Event Proposals')).toBeVisible();
  });

  test('adds an event and advances to Step 3 (Review)', async ({ page }) => {
    const wizard = new SanctioningWizardPage(page);
    await wizard.goto();

    // Step 1
    await wizard.fillBasicInfo(WIZARD_BASIC_INFO);
    await wizard.clickNext();

    // Step 2 — add event
    await wizard.addEvent(WIZARD_EVENT);
    await wizard.expectEventCount(1);
    await wizard.clickNext();

    // Step 3 — Review
    await wizard.expectSummaryContains(WIZARD_BASIC_INFO.tournamentName);
    await wizard.expectSummaryContains(WIZARD_EVENT.eventName);
  });

  test('review step shows no warnings when all fields complete', async ({ page }) => {
    const wizard = new SanctioningWizardPage(page);
    await wizard.goto();

    await wizard.fillBasicInfo(WIZARD_BASIC_INFO);
    await wizard.clickNext();

    await wizard.addEvent(WIZARD_EVENT);
    await wizard.clickNext();

    await wizard.expectNoValidationWarnings();
  });

  test('back button preserves form state', async ({ page }) => {
    const wizard = new SanctioningWizardPage(page);
    await wizard.goto();

    await wizard.fillBasicInfo(WIZARD_BASIC_INFO);
    await wizard.clickNext(); // → Step 2

    await wizard.addEvent(WIZARD_EVENT);
    await wizard.clickBack(); // → Step 1

    // Tournament name should still be filled
    const nameInput = page.getByLabel('Tournament Name');
    await expect(nameInput).toHaveValue(WIZARD_BASIC_INFO.tournamentName);
  });

  test('cancel button returns to dashboard', async ({ page }) => {
    const wizard = new SanctioningWizardPage(page);
    await wizard.goto();
    await wizard.cancelBtn.click();

    await expect(page).toHaveURL(/sanctioning$/);
  });
});
