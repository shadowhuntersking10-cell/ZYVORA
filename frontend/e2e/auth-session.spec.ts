/**
 * Real-browser regression test for "logged in, then bounced back to /login about a second later".
 *
 * No mocks, no artificial waits except the explicit 5 s / 60 s stability windows requested.
 * Every /api/auth/* exchange, console error and URL change is recorded and printed,
 * so a failure shows exactly which request lost its credentials.
 */
import { expect, test, type BrowserContext, type CDPSession, type Page, type Request } from '@playwright/test';

const PASSWORD = 'Passw0rd-E2E-1';

interface NetRow {
  at: number; // ms since test start
  method: string;
  path: string;
  status: number;
  ms: number;
  cookieSent: boolean;
  authSent: boolean;
  setCookie: boolean;
}

interface Evidence {
  started: number;
  net: NetRow[];
  console: string[];
  urls: string[];
}

function observe(page: Page): Evidence {
  const ev: Evidence = { started: Date.now(), net: [], console: [], urls: [] };
  const sentAt = new Map<Request, number>();
  page.on('request', (r) => { if (r.url().includes('/api/auth/')) sentAt.set(r, Date.now()); });
  page.on('response', async (res) => {
    const req = res.request();
    if (!req.url().includes('/api/auth/')) return;
    const headers = await req.allHeaders().catch(() => ({} as Record<string, string>));
    const path = new URL(req.url()).pathname;
    ev.net.push({
      at: Date.now() - ev.started,
      method: req.method(),
      path,
      status: res.status(),
      ms: Date.now() - (sentAt.get(req) ?? Date.now()),
      cookieSent: Boolean(headers.cookie && headers.cookie.includes('zyvora_refresh=')),
      authSent: Boolean(headers.authorization),
      setCookie: Boolean(res.headers()['set-cookie']),
    });
  });
  page.on('console', (m) => { if (m.type() === 'error') ev.console.push(m.text()); });
  page.on('pageerror', (e) => ev.console.push(`pageerror: ${e.message}`));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) ev.urls.push(`${Date.now() - ev.started}ms ${f.url()}`); });
  return ev;
}

function printEvidence(title: string, ev: Evidence) {
  const lines = [
    `===== ${title} =====`,
    'API /api/auth/* requests:',
    ...ev.net.map((n) => `  +${n.at}ms ${n.method} ${n.path} -> ${n.status} (${n.ms}ms) cookieSent=${n.cookieSent} authSent=${n.authSent} setCookie=${n.setCookie}`),
    'URL history:',
    ...ev.urls.map((u) => `  ${u}`),
    `Console errors (${ev.console.length}):`,
    ...ev.console.map((c) => `  ${c}`),
  ];
  console.log(lines.join('\n'));
}

function randomUser(tag: string) {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return { name: `E2E ${tag} ${id}`, email: `e2e-${tag}-${id}@example.com`, password: PASSWORD };
}

async function registerThroughUi(page: Page, user: { name: string; email: string; password: string }) {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(user.name);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByLabel('Confirm password').fill(user.password);
  await page.getByLabel('I agree to the Terms and Privacy Policy').check();
  await page.getByRole('button', { name: 'Create account' }).click();
}

async function loginThroughUi(page: Page, user: { email: string; password: string }) {
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

async function expectOnDashboard(page: Page, name: string) {
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.getByText(name).first()).toBeVisible();
}

/** Slow network: 500 ms latency on every request (CDP). */
async function slowNetwork(context: BrowserContext, page: Page): Promise<CDPSession> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 500, downloadThroughput: -1, uploadThroughput: -1,
  });
  return cdp;
}

/** Steps a and b: register lands on the dashboard, and the session stays for 5 s. */
async function registerAndStayFiveSeconds(page: Page, user: { name: string; email: string; password: string }) {
  await registerThroughUi(page, user);
  await expectOnDashboard(page, user.name);
  await page.waitForTimeout(5_000);
  await expectOnDashboard(page, user.name);
}

test.describe('session stays signed in', () => {
  test('register, stay 60 s, reload, navigate, logout, login again', async ({ page }) => {
    test.setTimeout(240_000);
    const ev = observe(page);
    const user = randomUser('main');

    // a + b
    await registerAndStayFiveSeconds(page, user);

    // c: total 60 s on the dashboard (5 s already elapsed)
    await page.waitForTimeout(55_000);
    await expectOnDashboard(page, user.name);

    // d: reload keeps the session
    await page.reload();
    await expectOnDashboard(page, user.name);

    // e: Projects, Assets, Settings are reachable without a redirect
    for (const path of ['/app/projects', '/app/asset-library', '/app/settings']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page).not.toHaveURL(/\/(login|register)/);
    }

    // f: logout, then log in again
    await page.goto('/app/dashboard');
    await expectOnDashboard(page, user.name);
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await loginThroughUi(page, user);
    await expectOnDashboard(page, user.name);

    printEvidence('main flow', ev);
    expect(ev.urls.filter((u) => /\/(login|register)/.test(u)).length).toBeGreaterThan(0); // logout sent us there
  });

  test('slow network (500 ms latency): register and stay signed in', async ({ page, context }) => {
    test.setTimeout(180_000);
    const ev = observe(page);
    await slowNetwork(context, page);
    await registerAndStayFiveSeconds(page, randomUser('slow'));
    printEvidence('slow network', ev);
  });

  test('fast double navigation: log in while the app is still booting', async ({ page, context }) => {
    test.setTimeout(180_000);
    const ev = observe(page);
    const user = randomUser('fast');
    try {
      // Create the account through the API so the UI test below only exercises login.
      const created = await page.request.post('/api/auth/register', { data: { name: user.name, email: user.email, password: user.password } });
      expect(created.status()).toBe(201);

      // Fresh browser state, then log in immediately. No waiting for the boot-time session restore.
      await context.clearCookies();
      await page.goto('/login', { waitUntil: 'commit' });
      await loginThroughUi(page, user);
      // Do NOT navigate manually: the app must move to the dashboard by itself after the login succeeds.
      await expect.poll(() => ev.net.some((n) => n.path === '/api/auth/login' && n.status === 200), { timeout: 15_000 }).toBe(true);
      await expectOnDashboard(page, user.name);
      await page.waitForTimeout(5_000);
      await expectOnDashboard(page, user.name);
    } finally {
      printEvidence('fast double navigation', ev);
    }
  });
});
