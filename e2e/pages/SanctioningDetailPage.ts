import { type Page, type Locator, expect } from '@playwright/test';

export class SanctioningDetailPage {
  readonly page: Page;
  readonly backBtn: Locator;
  readonly statusBadge: Locator;

  constructor(page: Page) {
    this.page = page;
    this.backBtn = page.locator('button:has(i.fa-arrow-left)');
    this.statusBadge = page.locator('span[style*="border-radius: 4px"]').first();
  }

  async goto(sanctioningId: string) {
    await this.page.goto(`/#/sanctioning/${sanctioningId}`);
    await this.page.waitForLoadState('networkidle');
  }

  async expectStatus(status: string) {
    const displayStatus = status.replace(/_/g, ' ');
    await expect(this.statusBadge).toContainText(displayStatus);
  }

  async expectTournamentName(name: string) {
    await expect(this.page.getByRole('heading', { name })).toBeVisible();
  }

  async expectPanelContains(panelTitle: string, text: string) {
    const panel = this.page.locator('div', { hasText: panelTitle }).first();
    await expect(panel).toContainText(text);
  }

  // --- Action Buttons ---
  async clickAction(label: string) {
    await this.page.getByRole('button', { name: label }).click();
  }

  async expectActionAvailable(label: string) {
    await expect(this.page.getByRole('button', { name: label })).toBeVisible();
  }

  async expectActionNotAvailable(label: string) {
    await expect(this.page.getByRole('button', { name: label })).toHaveCount(0);
  }

  // --- Confirmation dialog ---
  async confirmAction(reason?: string) {
    // The confirmModal shows "Ok" and "Cancel" buttons
    const dialog = this.page.locator('.cModal');
    await expect(dialog).toBeVisible();

    if (reason) {
      const textarea = dialog.locator('textarea');
      if (await textarea.isVisible()) {
        await textarea.fill(reason);
      }
    }

    await dialog.getByRole('button', { name: 'Ok' }).click();
  }

  // --- Status History ---
  async expectStatusHistoryContains(status: string) {
    const historySection = this.page.locator('text=Status History').locator('..');
    await expect(historySection).toContainText(status);
  }

  // --- Events Table ---
  async expectEventCount(count: number) {
    const rows = this.page.locator('table tbody tr');
    await expect(rows).toHaveCount(count);
  }

  async goBack() {
    await this.backBtn.click();
    await this.page.waitForURL(/sanctioning$/);
  }
}
