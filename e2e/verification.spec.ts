import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { field, signUp, unique } from './helpers';

// Some tests need to read the database to obtain the verification link that
// would have been emailed. In CI that is the test database. Locally, point
// E2E_DATABASE_URL at the database your servers use.
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  (process.env.E2E_SKIP_SERVERS
    ? undefined
    : (process.env.TEST_DATABASE_URL ??
      'postgresql://devflow:devflow@localhost:5433/devflow_test'));

/** Issues a link exactly as the API does and returns its path. */
async function verificationLink(email: string) {
  const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const token = randomBytes(32).toString('base64url');
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `/verify-email?token=${token}`;
  } finally {
    await prisma.$disconnect();
  }
}

test('new accounts are asked to confirm their email, and can ask for another link', async ({
  page,
}) => {
  await signUp(page, 'Vera');
  const banner = page
    .getByRole('status')
    .filter({ hasText: /confirm your email/i });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Resend link' }).click();
  await expect(banner.getByText(/link sent/i)).toBeVisible();
});

test('a bad verification link is explained, not silently ignored', async ({
  page,
}) => {
  await signUp(page, 'Bad');
  await page.goto('/verify-email?token=not-a-real-token');
  await expect(
    page.getByRole('alert').filter({ hasText: /invalid or has expired/i }),
  ).toBeVisible();
  await page.goto('/verify-email');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /missing its verification code/i }),
  ).toBeVisible();
});

test.describe('invitations', () => {
  test.skip(
    !DATABASE_URL,
    'needs database access to read the verification link',
  );

  test('can only be accepted after the invitee’s email is verified', async ({
    page,
    browser,
  }) => {
    const inviteeEmail = `invitee-${unique()}@example.com`;
    const workspaceName = `Verified ${unique()}`;

    // The owner creates a workspace and invites the address.
    await signUp(page, 'Olivia');
    await field(page, 'Workspace name').fill(workspaceName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await field(page, 'Email').fill(inviteeEmail);
    await page.getByRole('button', { name: 'Create invite' }).click();
    const inviteUrl = await field(page, 'Invitation link').inputValue();
    expect(inviteUrl).toContain('/invite?token=');

    // The invitee registers with that address but hasn't verified it yet.
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    const invitee = await context.newPage();
    await signUp(invitee, 'Ivan', inviteeEmail);
    await invitee.goto(inviteUrl);
    await expect(
      invitee.getByRole('status').filter({ hasText: /before accepting/i }),
    ).toBeVisible();
    await expect(
      invitee.getByRole('button', { name: 'Accept invitation' }),
    ).toBeDisabled();

    // Following the emailed link verifies the address...
    await invitee.goto(await verificationLink(inviteeEmail));
    await expect(
      invitee.getByRole('heading', { name: 'Email confirmed' }),
    ).toBeVisible();

    // ...after which the invitation can be accepted.
    await invitee.goto(inviteUrl);
    await expect(
      invitee.getByRole('button', { name: 'Accept invitation' }),
    ).toBeEnabled();
    await expect(invitee.getByText(/confirm your email/i)).toHaveCount(0);
    await invitee.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(
      invitee.getByRole('heading', { name: workspaceName }),
    ).toBeVisible();
    await context.close();
  });

  test('can’t be accepted by a different, verified person (the address must match)', async ({
    page,
    browser,
  }) => {
    await signUp(page, 'Owen');
    await field(page, 'Workspace name').fill(`Match ${unique()}`);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await field(page, 'Email').fill(`someone-${unique()}@example.com`);
    await page.getByRole('button', { name: 'Create invite' }).click();
    const inviteUrl = await field(page, 'Invitation link').inputValue();

    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    const other = await context.newPage();
    const email = await signUp(other, 'Other');
    await other.goto(await verificationLink(email));
    await expect(
      other.getByRole('heading', { name: 'Email confirmed' }),
    ).toBeVisible();
    await other.goto(inviteUrl);
    await other.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(
      other.getByRole('alert').filter({ hasText: /invalid or expired/i }),
    ).toBeVisible();
    await context.close();
  });
});
