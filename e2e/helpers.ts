import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-password-123';
/** Label lookup that ignores hidden (previously visited, still-mounted) pages. */
export const field = (page: Page, label: string) =>
  page.getByLabel(label).locator('visible=true');
export const unique = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function signUp(page: Page, name: string, address?: string) {
  const email = address ?? `${name.toLowerCase()}-${unique()}@example.com`;
  await page.goto('/register');
  await field(page, 'Name').fill(name);
  await field(page, 'Email').fill(email);
  await field(page, 'Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByRole('heading', { name: `Welcome, ${name}` }),
  ).toBeVisible();
  return email;
}

/** Creates a workspace and a project, and opens the board. */
export async function newBoard(page: Page) {
  const key = `E${Math.floor(Math.random() * 900 + 100)}`;
  await field(page, 'Workspace name').fill(`E2E ${unique()}`);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await field(page, 'Project name').fill('E2E Project');
  await field(page, 'Project key').fill(key);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('link', { name: /E2E Project/ }).click();
  await expect(
    page.getByRole('heading', { name: 'E2E Project' }),
  ).toBeVisible();
  return key;
}

export async function addTask(page: Page, column: string, title: string) {
  await page
    .getByRole('region', { name: column })
    .getByRole('button', { name: '+ Add task' })
    .click();
  await field(page, `New task in ${column}`).fill(title);
  await page.keyboard.press('Enter');
  await expect(page.getByText(title)).toBeVisible();
}
