import { expect, test } from '@playwright/test';
import { addTask, newBoard, signUp } from './helpers';

// These check the production build's headers, which CI starts. Against a dev
// server (E2E_SKIP_SERVERS) the strict Content-Security-Policy isn't applied.
test.skip(
  !!process.env.E2E_SKIP_SERVERS,
  'needs the production build that the Playwright config starts',
);

test('pages are served with hardening headers and no framework banner', async ({
  page,
}) => {
  const res = await page.goto('/login');
  const headers = res!.headers();
  expect(headers['x-powered-by']).toBeUndefined();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  const csp = headers['content-security-policy'];
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("form-action 'self'");
  expect(csp).not.toContain('unsafe-eval');
});

test('the app works under its Content-Security-Policy: no violations while using it', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to/i.test(m.text())) {
      problems.push(m.text());
    }
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));

  await signUp(page, 'Csp');
  await newBoard(page);
  await addTask(page, 'Backlog', 'Checked under CSP');
  await page.getByText('Checked under CSP').click();
  await expect(page.getByLabel('Title').locator('visible=true')).toHaveValue(
    'Checked under CSP',
  );
  await page.goto('/notifications');
  await expect(
    page.getByRole('heading', { name: 'Notifications' }),
  ).toBeVisible();
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();

  expect(problems).toEqual([]);
});

test('the sign-in page cannot be framed by another site', async ({
  page,
  baseURL,
}) => {
  await page.setContent(
    `<iframe id="f" src="${baseURL}/login" width="400" height="300"></iframe>`,
  );
  // A blocked frame is replaced by the browser's own error page.
  await expect
    .poll(() =>
      page
        .frames()
        .find((f) => f !== page.mainFrame())
        ?.url(),
    )
    .toMatch(/^chrome-error:/);
});
