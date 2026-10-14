import { expect, test } from '@playwright/test';

// Critical flow: register -> create project -> add a 3D object -> undo -> save indicator.
// NOTE: this spec is written but was NOT executed in the build sandbox (no browser download allowed).

test('register, open a project, add an object, undo', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd-E2E-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);

  await page.goto('/app/projects');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await expect(page).toHaveURL(/\/app\/projects\/.+\/3d/);

  await page.getByRole('button', { name: '+ Cube' }).click();
  await expect(page.getByRole('option', { name: /Cube 1/ })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(page.getByText('Empty scene. Add a primitive to start.').first()).toBeVisible();
});

test('non-admin is forbidden from the admin panel', async ({ page }) => {
  const email = `e2e-admin-${Date.now()}@example.com`;
  await page.request.post('/api/auth/register', { data: { name: 'Plain', email, password: 'Passw0rd-E2E-2' } });
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd-E2E-2');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await page.goto('/app/admin');
  await expect(page.getByText('403')).toBeVisible();
});
