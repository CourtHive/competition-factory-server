import { type Page, type Locator, expect } from '@playwright/test';

export class SanctioningDashboardPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly newApplicationBtn: Locator;
  readonly statusFilter: Locator;
  readonly searchInput: Locator;
  readonly tableRows: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Sanctioning Applications' });
    this.newApplicationBtn = page.getByRole('button', { name: 'New Application' });
    this.statusFilter = page.locator('select');
    this.searchInput = page.getByPlaceholder('Search tournament name');
    this.tableRows = page.locator('.tabulator-row');
  }

  async goto() {
    await this.page.goto('/#/sanctioning');
    await this.page.waitForLoadState('networkidle');
  }

  async expectVisible() {
    await expect(this.heading).toBeVisible();
  }

  async clickNewApplication() {
    await this.newApplicationBtn.click();
    await this.page.waitForURL(/sanctioning\/new/);
  }

  async filterByStatus(status: string) {
    await this.statusFilter.selectOption(status);
  }

  async searchByName(name: string) {
    await this.searchInput.fill(name);
  }

  async getRowCount() {
    return this.tableRows.count();
  }

  async clickRow(index: number) {
    await this.tableRows.nth(index).click();
  }

  async expectRowWithText(text: string) {
    await expect(this.page.locator('.tabulator-row', { hasText: text })).toBeVisible();
  }
}
