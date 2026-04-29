/**
 * End-to-end smoke for the OAuth 2.1 + PKCE login flow (Phase 0 work
 * items 6 + 7). Drives a real browser through the full round-trip
 * against a live Stalwart deployment:
 *
 *   1. App loads at the dev origin and shows "Sign in with Stalwart".
 *   2. Click → browser navigates to the configured OIDC issuer's
 *      authorization endpoint with the right query params (PKCE
 *      challenge present, state non-empty, scope contains `openid`).
 *   3. Stalwart's login form loads (proves issuer reachability +
 *      redirect URI registration).
 *   4. Test fills credentials, submits, follows the callback redirect.
 *   5. Shell completes the code exchange, persists tokens, and renders
 *      "Signed in as <email>" sourced from `useSessionGet`.
 *
 * Required env vars (none committed):
 *   IARSMA_E2E_OIDC_ISSUER       e.g. https://sw-mail.r3motely.net
 *   IARSMA_E2E_CLIENT_ID         e.g. webmail   (default: 'webmail')
 *   IARSMA_E2E_TEST_USERNAME     full email address
 *   IARSMA_E2E_TEST_PASSWORD     password for the above account
 *
 * Optional:
 *   IARSMA_E2E_HOST              default 'localhost'
 *   IARSMA_E2E_PORT              default 5173
 *   IARSMA_E2E_REDIRECT_URI      default `http://${HOST}:${PORT}/auth/callback`
 *
 * Skips itself when the required vars are absent so a casual
 * `pnpm e2e` doesn't fail loud on a fresh clone.
 */

import { expect, test } from '@playwright/test';

const ISSUER = process.env['IARSMA_E2E_OIDC_ISSUER'];
const USERNAME = process.env['IARSMA_E2E_TEST_USERNAME'];
const PASSWORD = process.env['IARSMA_E2E_TEST_PASSWORD'];

const HAS_REQUIRED_ENV =
  ISSUER !== undefined &&
  ISSUER.length > 0 &&
  USERNAME !== undefined &&
  USERNAME.length > 0 &&
  PASSWORD !== undefined &&
  PASSWORD.length > 0;

test.describe('OAuth 2.1 + PKCE login', () => {
  test.skip(
    !HAS_REQUIRED_ENV,
    'requires IARSMA_E2E_OIDC_ISSUER + IARSMA_E2E_TEST_USERNAME + IARSMA_E2E_TEST_PASSWORD',
  );

  test('redirects to issuer login form with valid PKCE params', async ({ page }) => {
    await page.goto('/');

    // Phase 0 work item 7: visible "Sign in" button on the unauthenticated view.
    const signInBtn = page.getByRole('button', { name: /sign in with stalwart/i });
    await expect(signInBtn).toBeVisible();

    // Capture the navigation triggered by clicking sign-in.
    const [navigation] = await Promise.all([
      page.waitForURL((url) => url.toString().startsWith(ISSUER!)),
      signInBtn.click(),
    ]);
    void navigation;

    const issuerUrl = new URL(page.url());
    expect(issuerUrl.origin).toBe(new URL(ISSUER!).origin);
    expect(issuerUrl.searchParams.get('client_id')).toBeTruthy();
    expect(issuerUrl.searchParams.get('response_type')).toBe('code');
    expect(issuerUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(issuerUrl.searchParams.get('code_challenge')?.length ?? 0).toBeGreaterThan(20);
    expect(issuerUrl.searchParams.get('state')?.length ?? 0).toBeGreaterThan(8);
    expect(issuerUrl.searchParams.get('scope') ?? '').toContain('openid');
    expect(issuerUrl.searchParams.get('redirect_uri')).toContain('/auth/callback');
  });

  test('completes round-trip and renders the JMAP-sourced username', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /sign in with stalwart/i }).click();

    // Stalwart's login form. The exact selectors are version-dependent;
    // we use generic labels so a Stalwart UI revision doesn't silently
    // break this test — if the locators stop matching, the test fails
    // loudly with a screenshot instead of green-on-broken.
    await page.waitForURL((url) => url.toString().startsWith(ISSUER!));
    const userField = page
      .getByLabel(/email|user(name)?/i)
      .or(page.locator('input[name="username"], input[name="email"], input[type="email"]'))
      .first();
    const passField = page
      .getByLabel(/password/i)
      .or(page.locator('input[type="password"], input[name="password"]'))
      .first();
    const submitBtn = page
      .getByRole('button', { name: /sign in|log in|continue/i })
      .or(page.locator('button[type="submit"]'))
      .first();

    await userField.fill(USERNAME!);
    await passField.fill(PASSWORD!);

    // After submit we expect: Stalwart consent (maybe) → callback URL → shell home.
    // Wait until the URL leaves the issuer and the shell renders its
    // signed-in heading.
    await Promise.all([
      page.waitForURL(
        (url) => !url.toString().startsWith(ISSUER!) && !url.search.includes('code='),
        { timeout: 30_000 },
      ),
      submitBtn.click(),
    ]);

    // Phase 0 work item 7 definition of done — shell shows "Signed in"
    // sourced from `useSessionGet`'s real JMAP response.
    await expect(page.getByRole('heading', { name: /signed in/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(USERNAME!, { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    // Sign-out button is present and re-renders to the signed-out view.
    const signOutBtn = page.getByRole('button', { name: /sign out/i });
    await expect(signOutBtn).toBeVisible();
    await signOutBtn.click();
    await expect(
      page.getByRole('button', { name: /sign in with stalwart/i }),
    ).toBeVisible();
  });
});
