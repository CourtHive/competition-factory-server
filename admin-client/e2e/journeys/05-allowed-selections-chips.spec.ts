/**
 * E2E coverage for the Allowed Selections chip widget.
 *
 * The widget powers the Settings panel → Allowed Selections topic (draw
 * types, creation methods, scoring approaches, matchUp formats). It runs
 * in two modes:
 *   - unrestricted: text input + "+" button to add arbitrary values
 *   - restricted:   one chip per provisioner-allowed value, click to toggle
 *
 * Both modes have been reported as "+ doesn't work" in the live app. This
 * suite exercises them through a real browser (CSS + click-bubbling) via
 * a fixture page rather than spinning up a full provider/tournament context.
 *
 * Fixture: e2e/fixtures/chip-test.html — Vite serves it on the fly and
 * resolves the relative .ts/.css imports through the dev server.
 */
import { test, expect, type Page } from '@playwright/test';

const FIXTURE_PATH = 'e2e/fixtures/chip-test.html';

async function gotoFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE_PATH);
  // Wait for the inline module to finish setting up the widgets.
  await page.waitForFunction(() => (window as any).__chipFixtureReady === true);
}

async function readEvents(page: Page): Promise<Array<{ kind: string; next: string[] }>> {
  return page.evaluate(() => (window as any).__chipEvents.slice());
}

test.describe('Allowed Selections — unrestricted (input + + button)', () => {
  test('typing a value and clicking + emits the new value', async ({ page }) => {
    await gotoFixture(page);

    const fixture = page.locator('[data-fixture="unrestricted"]');
    const input = fixture.locator('.sp-chip-add-input');
    const addBtn = fixture.locator('.sp-chip-add-btn');

    await input.fill('SINGLE_ELIMINATION');
    // Sync state should pick up the typed value and mark the button "ready".
    await expect(addBtn).toHaveClass(/is-ready/);

    await addBtn.click();

    const events = await readEvents(page);
    expect(events.at(-1)).toEqual({ kind: 'unrestricted', next: ['SINGLE_ELIMINATION'] });

    // After commit, a fresh chip plus a fresh input should be in the DOM.
    await expect(fixture.locator('.sp-chip').filter({ hasText: 'SINGLE_ELIMINATION' })).toBeVisible();
    await expect(fixture.locator('.sp-chip-add-input')).toHaveValue('');
  });

  test('pressing Enter on the input commits the value', async ({ page }) => {
    await gotoFixture(page);

    const fixture = page.locator('[data-fixture="unrestricted"]');
    const input = fixture.locator('.sp-chip-add-input');

    await input.fill('ROUND_ROBIN');
    await input.press('Enter');

    const events = await readEvents(page);
    expect(events.at(-1)).toEqual({ kind: 'unrestricted', next: ['ROUND_ROBIN'] });
  });

  test('clicking + with empty input focuses the input and emits nothing', async ({ page }) => {
    await gotoFixture(page);

    const fixture = page.locator('[data-fixture="unrestricted"]');
    const input = fixture.locator('.sp-chip-add-input');
    const addBtn = fixture.locator('.sp-chip-add-btn');

    await addBtn.click();

    expect(await readEvents(page)).toHaveLength(0);
    await expect(input).toBeFocused();
  });

  test('removing a chip via its x icon emits without the value', async ({ page }) => {
    await gotoFixture(page);

    const fixture = page.locator('[data-fixture="unrestricted"]');
    const input = fixture.locator('.sp-chip-add-input');
    const addBtn = fixture.locator('.sp-chip-add-btn');

    await input.fill('COMPASS');
    await addBtn.click();
    await expect(fixture.locator('.sp-chip').filter({ hasText: 'COMPASS' })).toBeVisible();

    await fixture.locator('.sp-chip').filter({ hasText: 'COMPASS' }).click();

    const events = await readEvents(page);
    expect(events.at(-1)).toEqual({ kind: 'unrestricted', next: [] });
  });
});

test.describe('Allowed Selections — full universe (factory enum)', () => {
  test('renders one chip per factory enum value, no free-form input', async ({ page }) => {
    await gotoFixture(page);

    const fixture = page.locator('[data-fixture="full-universe"]');
    await expect(fixture.locator('.sp-chip')).toHaveCount(3);
    await expect(fixture.locator('.sp-chip-add-input')).toHaveCount(0);
  });

  test('clicking an unselected chip selects it and emits the value', async ({ page }) => {
    await gotoFixture(page);

    const fixture = page.locator('[data-fixture="full-universe"]');
    const chip = fixture.locator('.sp-chip').filter({ hasText: 'AUTOMATED' });
    await expect(chip).not.toHaveClass(/is-selected/);
    await chip.click();
    await expect(chip).toHaveClass(/is-selected/);

    const events = await readEvents(page);
    expect(events.at(-1)).toEqual({ kind: 'full-universe', next: ['AUTOMATED'] });
  });
});

test.describe('Allowed Selections — restricted (chip toggle)', () => {
  test('clicking an unselected chip selects it and emits the value', async ({ page }) => {
    await gotoFixture(page);

    const fixture = page.locator('[data-fixture="restricted"]');
    const chip = fixture.locator('.sp-chip').filter({ hasText: 'SINGLE_ELIMINATION' });

    await expect(chip).not.toHaveClass(/is-selected/);
    await chip.click();
    await expect(chip).toHaveClass(/is-selected/);

    const events = await readEvents(page);
    expect(events.at(-1)?.kind).toBe('restricted');
    expect(events.at(-1)?.next).toContain('SINGLE_ELIMINATION');
  });

  test('clicking a selected chip removes it from the selection', async ({ page }) => {
    await gotoFixture(page);

    const fixture = page.locator('[data-fixture="restricted"]');
    const chip = fixture.locator('.sp-chip').filter({ hasText: 'ROUND_ROBIN' });

    await chip.click();
    await expect(chip).toHaveClass(/is-selected/);
    await chip.click();
    await expect(chip).not.toHaveClass(/is-selected/);

    const events = await readEvents(page);
    const last = events.at(-1)!;
    expect(last.kind).toBe('restricted');
    expect(last.next).not.toContain('ROUND_ROBIN');
  });

  test('out-of-cap orphan values render with the orphan modifier and toggle off', async ({ page }) => {
    await gotoFixture(page);

    const fixture = page.locator('[data-fixture="restricted"]');
    const orphan = fixture.locator('.sp-chip.is-orphan').filter({ hasText: 'LEGACY' });

    await expect(orphan).toHaveCount(1);
    await orphan.click();

    const events = await readEvents(page);
    expect(events.at(-1)?.kind).toBe('restricted');
    expect(events.at(-1)?.next).not.toContain('LEGACY');
  });

  test('clicks land on the chip even when the user clicks on the inner icon', async ({ page }) => {
    // This is the regression that motivated `pointer-events: none` on chip
    // children — Font Awesome glyphs were eating clicks in some host CSS.
    await gotoFixture(page);

    const fixture = page.locator('[data-fixture="restricted"]');
    const chip = fixture.locator('.sp-chip').filter({ hasText: 'COMPASS' });

    await chip.locator('i').click();
    await expect(chip).toHaveClass(/is-selected/);

    const events = await readEvents(page);
    expect(events.at(-1)?.next).toContain('COMPASS');
  });
});
