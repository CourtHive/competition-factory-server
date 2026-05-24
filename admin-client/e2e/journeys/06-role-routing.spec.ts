import { test, expect, request as apiRequest, type APIRequestContext } from '@playwright/test';
import {
  ensureProvider,
  createProvisioner,
  removeUser,
  assignProvisionerRep,
  createLoginableUser,
  associateProviderToProvisioner,
  E2E_ROLE_PASSWORD,
  uniqueSuffix,
} from '../helpers/fixtures';
import { cleanupProvisioner } from '../helpers/cleanup';
import { loginAs, signInViaApi } from '../helpers/login';
import { S } from '../helpers/selectors';

/**
 * Journey 06 — role-based routing into the admin console.
 *
 * Covers the matrix introduced by the provisioner-admin-routing work: the
 * admin-client routes super-admin → /system, provisioner → /provisioner,
 * PROVIDER_ADMIN → /admin, and everyone else (DIRECTOR / plain client) to the
 * /no-access view instead of silently dumping them into /admin. Also guards the
 * /admin deep-link and the no-access logout path.
 *
 * Seeds real server users via the admin API (bootstrap super-admin token) and
 * tears them down in afterAll. Requires a live server on :8383 (global-setup
 * asserts it). Legacy global-`admin` routing is covered by the adminAccess unit
 * test — admin-create-user rejects that deprecated role, so it's not seeded here.
 */
const suffix = uniqueSuffix();
const PROVIDER_ADMIN_EMAIL = `e2e-padmin-${suffix}@courthive.test`;
const DIRECTOR_EMAIL = `e2e-director-${suffix}@courthive.test`;
const PLAIN_EMAIL = `e2e-plain-${suffix}@courthive.test`;
const REP_EMAIL = `e2e-prov-rep-${suffix}@courthive.test`;
const PROVISIONER_NAME = `E2E-Role-Provisioner-${suffix}`;

let ctx: APIRequestContext;
let token: string;
let providerId: string;
let provisionerId: string;

test.describe('Journey 06 — role-based routing', () => {
  test.beforeAll(async () => {
    ctx = await apiRequest.newContext();
    token = await signInViaApi(ctx);

    providerId = await ensureProvider(ctx, token, 'E2EROLE', 'E2E Role Provider');

    await createLoginableUser(ctx, token, {
      email: PROVIDER_ADMIN_EMAIL,
      roles: ['client'],
      providerId,
      providerRole: 'PROVIDER_ADMIN',
    });
    await createLoginableUser(ctx, token, {
      email: DIRECTOR_EMAIL,
      roles: ['client'],
      providerId,
      providerRole: 'DIRECTOR',
    });
    await createLoginableUser(ctx, token, { email: PLAIN_EMAIL, roles: ['client'] });

    // Provisioner representative: create the user, then a provisioner that owns
    // the provider, then attach the user as a rep (grants the PROVISIONER role).
    await createLoginableUser(ctx, token, { email: REP_EMAIL, roles: ['client'] });
    provisionerId = await createProvisioner(ctx, token, PROVISIONER_NAME);
    await associateProviderToProvisioner(ctx, token, provisionerId, providerId, 'owner');
    await assignProvisionerRep(ctx, token, provisionerId, REP_EMAIL);
  });

  test.afterAll(async () => {
    if (!ctx) return;
    await cleanupProvisioner(ctx, provisionerId);
    await removeUser(ctx, token, PROVIDER_ADMIN_EMAIL);
    await removeUser(ctx, token, DIRECTOR_EMAIL);
    await removeUser(ctx, token, PLAIN_EMAIL);
    await removeUser(ctx, token, REP_EMAIL);
    await ctx.dispose();
  });

  test('PROVIDER_ADMIN lands on /admin', async ({ page }) => {
    await loginAs(page, PROVIDER_ADMIN_EMAIL, E2E_ROLE_PASSWORD);
    await expect(page).toHaveURL(/#\/admin/);
    await expect(page.locator(S.TMX_ADMIN)).toBeVisible();
  });

  test('a DIRECTOR-only account lands on /no-access, not /admin', async ({ page }) => {
    await loginAs(page, DIRECTOR_EMAIL, E2E_ROLE_PASSWORD);
    await expect(page).toHaveURL(/#\/no-access/);
    await expect(page.getByText('No admin access')).toBeVisible();
  });

  test('a plain client account lands on /no-access', async ({ page }) => {
    await loginAs(page, PLAIN_EMAIL, E2E_ROLE_PASSWORD);
    await expect(page).toHaveURL(/#\/no-access/);
  });

  test('a provisioner representative lands on /provisioner', async ({ page }) => {
    await loginAs(page, REP_EMAIL, E2E_ROLE_PASSWORD);
    await expect(page).toHaveURL(/#\/provisioner/);
    await expect(page.locator(S.TMX_PROVISIONER)).toBeVisible();
  });

  test('a DIRECTOR deep-linking to /admin is bounced to /no-access', async ({ page }) => {
    await loginAs(page, DIRECTOR_EMAIL, E2E_ROLE_PASSWORD);
    await page.goto('/#/admin');
    await expect(page).toHaveURL(/#\/no-access/);
  });

  test('no-access logout returns the user to the login affordance', async ({ page }) => {
    await loginAs(page, DIRECTOR_EMAIL, E2E_ROLE_PASSWORD);
    await expect(page.getByText('No admin access')).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.locator(S.LOGIN)).toBeVisible();
  });
});
