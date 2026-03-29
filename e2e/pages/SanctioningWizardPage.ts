import { type Page, type Locator, expect } from '@playwright/test';

export class SanctioningWizardPage {
  readonly page: Page;
  readonly nextBtn: Locator;
  readonly backBtn: Locator;
  readonly cancelBtn: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nextBtn = page.getByRole('button', { name: 'Next' });
    this.backBtn = page.getByRole('button', { name: 'Back' });
    this.cancelBtn = page.getByRole('button', { name: 'Cancel' });
  }

  async goto() {
    await this.page.goto('/#/sanctioning/new');
    await this.page.waitForLoadState('networkidle');
  }

  // ---- Step 1: Basic Info ----
  async fillBasicInfo({
    tournamentName,
    startDate,
    endDate,
    country,
    surface,
    indoorOutdoor,
    level,
    governingBody,
    orgName,
    contactName,
    contactEmail,
  }: {
    tournamentName: string;
    startDate: string;
    endDate: string;
    country?: string;
    surface?: string;
    indoorOutdoor?: string;
    level?: string;
    governingBody?: string;
    orgName?: string;
    contactName?: string;
    contactEmail?: string;
  }) {
    // Fill inputs by label text
    await this.page.getByLabel('Tournament Name').fill(tournamentName);
    await this.page.getByLabel('Start Date').fill(startDate);
    await this.page.getByLabel('End Date').fill(endDate);

    if (country) await this.page.getByLabel('Country Code').fill(country);
    if (level) await this.page.getByLabel('Sanctioning Level').fill(level);
    if (governingBody) await this.page.getByLabel('Governing Body').fill(governingBody);

    if (surface) await this.page.getByLabel('Surface').selectOption(surface);
    if (indoorOutdoor) await this.page.getByLabel('Indoor/Outdoor').selectOption(indoorOutdoor);

    // Applicant details
    if (orgName) await this.page.getByLabel('Organisation Name').fill(orgName);
    if (contactName) await this.page.getByLabel('Contact Name').fill(contactName);
    if (contactEmail) await this.page.getByLabel('Contact Email').fill(contactEmail);
  }

  // ---- Step 2: Events ----
  async addEvent({
    eventName,
    eventType,
    gender,
    drawSize,
    drawType,
    matchUpFormat,
  }: {
    eventName: string;
    eventType: string;
    gender?: string;
    drawSize?: number;
    drawType?: string;
    matchUpFormat?: string;
  }) {
    await this.page.getByRole('button', { name: '+ Add Event' }).click();

    // Modal should open
    const modal = this.page.locator('.cModal, [role="dialog"]');
    await expect(modal).toBeVisible();

    // Fill modal fields
    await modal.getByLabel('Event Name').fill(eventName);
    await modal.getByLabel('Event Type').selectOption(eventType);
    if (gender) await modal.getByLabel('Gender').selectOption(gender);
    if (drawSize) await modal.getByLabel('Draw Size').fill(String(drawSize));
    if (drawType) await modal.getByLabel('Draw Type').selectOption(drawType);
    if (matchUpFormat) await modal.getByLabel('Match Format').fill(matchUpFormat);

    // Click Add button in modal
    await modal.getByRole('button', { name: 'Add' }).click();
  }

  async expectEventCount(count: number) {
    const rows = this.page.locator('table tbody tr');
    await expect(rows).toHaveCount(count);
  }

  // ---- Step 3: Review & Submit ----
  async expectSummaryContains(text: string) {
    await expect(this.page.locator('#tmxSanctioning')).toContainText(text);
  }

  async expectNoValidationWarnings() {
    const warnings = this.page.locator('[style*="fff3cd"]');
    await expect(warnings).toHaveCount(0);
  }

  async expectValidationWarnings() {
    const warnings = this.page.locator('[style*="fff3cd"]');
    await expect(warnings).toHaveCount(1);
  }

  async clickSaveDraft() {
    await this.page.getByRole('button', { name: 'Save as Draft' }).click();
  }

  async clickSubmit() {
    await this.page.getByRole('button', { name: 'Save & Submit Application' }).click();
  }

  // ---- Navigation ----
  async clickNext() {
    await this.nextBtn.click();
  }

  async clickBack() {
    await this.backBtn.click();
  }

  async expectOnStep(stepNumber: number) {
    // Step indicators — the active step has blue background
    const activeStep = this.page.locator(`div >> text="${stepNumber}"`).first();
    await expect(activeStep).toBeVisible();
  }
}
