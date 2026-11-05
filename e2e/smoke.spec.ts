import { expect, test } from '@playwright/test';
import { PASSWORD, addTask, field, newBoard, signUp } from './helpers';

test('a new user can sign up, set up a workspace and project, and track a task', async ({
  page,
}) => {
  await signUp(page, 'Casey');
  const key = await newBoard(page);

  await addTask(page, 'Backlog', 'Write the launch plan');
  await expect(page.getByText(`${key}-1`)).toBeVisible();

  // Open the task, change its priority and comment on it.
  await page.getByText('Write the launch plan').click();
  await expect(field(page, 'Title')).toHaveValue('Write the launch plan');
  await field(page, 'Priority').selectOption('HIGH');
  await field(page, 'New comment').fill('Starting on this today');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByText('Starting on this today')).toBeVisible();
  // The history records what happened.
  await expect(
    page.getByText(/changed priority from MEDIUM to HIGH/),
  ).toBeVisible();

  await page.reload();
  await expect(field(page, 'Priority')).toHaveValue('HIGH');
  await expect(page.getByText('Starting on this today')).toBeVisible();
});

test('dragging a card to another column persists after a reload', async ({
  page,
}) => {
  await signUp(page, 'Drew');
  await newBoard(page);
  await addTask(page, 'Backlog', 'Drag me');

  const card = page.getByText('Drag me');
  const target = page.getByRole('region', { name: 'In Progress' });
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('could not measure the board');

  // dnd-kit needs real pointer movement, not a synthetic drop.
  await page.mouse.move(from.x + 10, from.y + 5);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 10 });
  await page.mouse.up();

  await expect(target.getByText('Drag me')).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'In Progress' }).getByText('Drag me'),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Backlog' }).getByText('Drag me'),
  ).toHaveCount(0);
});

test('protected pages send visitors to sign in, then bring them back', async ({
  page,
  browser,
}) => {
  // Create the account in a separate browser context so `page` stays signed out.
  const setup = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
  });
  const email = await signUp(await setup.newPage(), 'Robin');
  await setup.close();

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  await field(page, 'Email').fill(email);
  await field(page, 'Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole('heading', { name: 'Welcome, Robin' }),
  ).toBeVisible();
});

test('a wrong password is rejected and stays on the sign-in page', async ({
  page,
}) => {
  const email = await signUp(page, 'Sam');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await field(page, 'Email').fill(email);
  await field(page, 'Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Invalid credentials' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('the session survives a reload and ends on sign-out', async ({ page }) => {
  await signUp(page, 'Taylor');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Welcome, Taylor' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
