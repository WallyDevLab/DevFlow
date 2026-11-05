import { createHash } from 'node:crypto';
import { createApp } from './helpers/app.js';
import {
  PASSWORD,
  eventually,
  signup,
  uid,
  verifyEmail,
  workspaceWith,
  type TestUser,
} from './helpers/factory.js';

type Ctx = Awaited<ReturnType<typeof createApp>>;
let ctx: Ctx;

beforeAll(async () => {
  ctx = await createApp();
});
afterAll(async () => {
  await ctx.app.close();
});
afterEach(() => {
  process.env.DISABLE_THROTTLE = 'true';
});

const LINK = /verify-email\?token=([\w-]+)/;
const verifyMails = (email: string) =>
  ctx.mailbox.to(email, /confirm your email/i);
const tokenFor = (email: string) => ctx.mailbox.extract(email, LINK)!;
const me = async (u: TestUser) => (await ctx.api(u.token).get('/auth/me')).body;

/** Moves a user's tokens out of the resend cool-down window. */
const ageTokens = (userId: string) =>
  ctx.prisma.emailVerificationToken.updateMany({
    where: { userId },
    data: { createdAt: new Date(Date.now() - 10 * 60_000) },
  });

describe('after registering', () => {
  it('starts unverified and emails one confirmation link', async () => {
    const u = await signup(ctx.api, 'Fresh', { verify: false });
    expect(await me(u)).toMatchObject({ emailVerified: false });
    await eventually(() => expect(verifyMails(u.email)).toHaveLength(1));
    expect(verifyMails(u.email)[0].text).toMatch(LINK);
  });

  it('reports the state in the registration and sign-in responses', async () => {
    const email = `state-${uid()}@example.com`;
    const reg = await ctx
      .api()
      .post('/auth/register', { email, password: PASSWORD, name: 'State' });
    expect(reg.body.user.emailVerified).toBe(false);
    const login = await ctx
      .api()
      .post('/auth/login', { email, password: PASSWORD });
    expect(login.body.user.emailVerified).toBe(false);
  });

  it('stores only a hash of the token, never the token', async () => {
    const u = await signup(ctx.api, 'Hashed', { verify: false });
    await eventually(() => expect(verifyMails(u.email)).toHaveLength(1));
    const token = tokenFor(u.email);
    expect(
      await ctx.prisma.emailVerificationToken.count({
        where: { tokenHash: token },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.emailVerificationToken.count({
        where: { tokenHash: createHash('sha256').update(token).digest('hex') },
      }),
    ).toBe(1);
  });

  it('lets an unverified user keep working: only invitations are gated', async () => {
    const u = await signup(ctx.api, 'Works', { verify: false });
    const ws = await ctx
      .api(u.token)
      .post('/workspaces', { name: 'Unverified WS' });
    expect(ws.status).toBe(201);
    expect((await ctx.api(u.token).get('/workspaces')).status).toBe(200);
  });
});

describe('following the link', () => {
  it('verifies the address, once', async () => {
    const u = await signup(ctx.api, 'Click', { verify: false });
    await eventually(() => expect(verifyMails(u.email)).toHaveLength(1));
    const token = tokenFor(u.email);
    expect((await ctx.api().post('/auth/verify-email', { token })).status).toBe(
      204,
    );
    expect(await me(u)).toMatchObject({ emailVerified: true });
    expect((await ctx.api().post('/auth/verify-email', { token })).status).toBe(
      400,
    ); // single use
  });

  it('needs no sign-in: the link itself is the credential', async () => {
    const u = await signup(ctx.api, 'Anon', { verify: false });
    await eventually(() => expect(verifyMails(u.email)).toHaveLength(1));
    expect(
      (await ctx.api().post('/auth/verify-email', { token: tokenFor(u.email) }))
        .status,
    ).toBe(204);
  });

  it('rejects unknown, empty, oversized and expired tokens with the same error', async () => {
    const u = await signup(ctx.api, 'Expired', { verify: false });
    await eventually(() => expect(verifyMails(u.email)).toHaveLength(1));
    const real = tokenFor(u.email);
    await ctx.prisma.emailVerificationToken.updateMany({
      where: { userId: u.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await ctx.api().post('/auth/verify-email', { token: real });
    const unknown = await ctx
      .api()
      .post('/auth/verify-email', { token: 'nonsense' });
    expect([expired.status, unknown.status]).toEqual([400, 400]);
    expect(expired.body.message).toBe(unknown.body.message);
    expect(
      (await ctx.api().post('/auth/verify-email', { token: '' })).status,
    ).toBe(400 /* validation or invalid */);
    expect(
      (await ctx.api().post('/auth/verify-email', { token: 'x'.repeat(500) }))
        .status,
    ).toBe(400);
    expect((await ctx.api().post('/auth/verify-email', {})).status).toBe(400);
    expect(await me(u)).toMatchObject({ emailVerified: false });
  });

  it('only verifies the account the link was sent to', async () => {
    const [a, b] = await Promise.all([
      signup(ctx.api, 'First', { verify: false }),
      signup(ctx.api, 'Second', { verify: false }),
    ]);
    await eventually(() => expect(verifyMails(b.email)).toHaveLength(1));
    await ctx.api().post('/auth/verify-email', { token: tokenFor(b.email) });
    expect(await me(a)).toMatchObject({ emailVerified: false });
    expect(await me(b)).toMatchObject({ emailVerified: true });
  });

  it('can’t be used twice by simultaneous requests', async () => {
    const u = await signup(ctx.api, 'Race', { verify: false });
    await eventually(() => expect(verifyMails(u.email)).toHaveLength(1));
    const token = tokenFor(u.email);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.api().post('/auth/verify-email', { token }),
      ),
    );
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
  });
});

describe('resending the link', () => {
  it('requires being signed in', async () => {
    expect((await ctx.api().post('/auth/resend-verification')).status).toBe(
      401,
    );
  });

  it('sends a new link and retires the old one', async () => {
    const u = await signup(ctx.api, 'Resend', { verify: false });
    await eventually(() => expect(verifyMails(u.email)).toHaveLength(1));
    const first = tokenFor(u.email);
    await ageTokens(u.id);
    expect(
      (await ctx.api(u.token).post('/auth/resend-verification')).status,
    ).toBe(202);
    await eventually(() => expect(verifyMails(u.email)).toHaveLength(2));
    const second = tokenFor(u.email);
    expect(second).not.toBe(first);
    expect(
      (await ctx.api().post('/auth/verify-email', { token: first })).status,
    ).toBe(400);
    expect(
      (await ctx.api().post('/auth/verify-email', { token: second })).status,
    ).toBe(204);
  });

  it('can’t be used to flood an inbox (one email a minute per account)', async () => {
    const u = await signup(ctx.api, 'Flood', { verify: false });
    await eventually(() => expect(verifyMails(u.email)).toHaveLength(1));
    for (let i = 0; i < 3; i++)
      await ctx.api(u.token).post('/auth/resend-verification');
    await new Promise((r) => setTimeout(r, 300));
    expect(verifyMails(u.email)).toHaveLength(1);
  });

  it('does nothing for an address that is already verified', async () => {
    const u = await signup(ctx.api, 'Done');
    const before = verifyMails(u.email).length;
    expect(
      (await ctx.api(u.token).post('/auth/resend-verification')).status,
    ).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    expect(verifyMails(u.email)).toHaveLength(before);
  });

  it('is rate limited', async () => {
    const u = await signup(ctx.api, 'Limited', { verify: false });
    process.env.DISABLE_THROTTLE = 'false';
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++)
      statuses.push(
        (await ctx.api(u.token).post('/auth/resend-verification')).status,
      );
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});

describe('invitations require a verified address', () => {
  async function invite(owner: TestUser, email: string) {
    const ws = await workspaceWith(ctx.api, owner, [], 'Invite WS');
    const inv = await ctx
      .api(owner.token)
      .post(`/workspaces/${ws}/invitations`, { email, role: 'DEVELOPER' });
    return { ws, token: inv.body.token as string };
  }

  it('refuses an unverified invitee, without using up the invitation', async () => {
    const owner = await signup(ctx.api, 'Owner');
    const invitee = await signup(ctx.api, 'Invitee', { verify: false });
    const { ws, token } = await invite(owner, invitee.email);

    const refused = await ctx
      .api(invitee.token)
      .post('/invitations/accept', { token });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/verify your email/i);
    expect((await ctx.api(invitee.token).get(`/workspaces/${ws}`)).status).toBe(
      404,
    );

    await verifyEmail(ctx.api, invitee);
    const ok = await ctx
      .api(invitee.token)
      .post('/invitations/accept', { token });
    expect(ok.status).toBe(200);
    expect((await ctx.api(invitee.token).get(`/workspaces/${ws}`)).status).toBe(
      200,
    );
  });

  it('stops someone who registers an address they don’t own from joining its workspaces', async () => {
    // The owner invites a real person; an attacker has registered that address
    // first and somehow obtained the invitation token.
    const owner = await signup(ctx.api, 'Owner');
    const victimEmail = `victim-${uid()}@example.com`;
    const { ws, token } = await invite(owner, victimEmail);

    const attacker = await ctx.api().post('/auth/register', {
      email: victimEmail,
      password: PASSWORD,
      name: 'Attacker',
    });
    const attackerToken = attacker.body.accessToken as string;
    expect(
      (await ctx.api(attackerToken).post('/invitations/accept', { token }))
        .status,
    ).toBe(403);
    expect((await ctx.api(attackerToken).get(`/workspaces/${ws}`)).status).toBe(
      404,
    );
  });

  it('still refuses a verified user whose address doesn’t match the invitation', async () => {
    const owner = await signup(ctx.api, 'Owner');
    const wrongPerson = await signup(ctx.api, 'Wrong'); // verified, but a different address
    const { token } = await invite(owner, `someone-${uid()}@example.com`);
    expect(
      (await ctx.api(wrongPerson.token).post('/invitations/accept', { token }))
        .status,
    ).toBe(400);
  });
});

describe('resetting a password also verifies the address', () => {
  it('because the reset link proves control of the mailbox', async () => {
    const u = await signup(ctx.api, 'ResetVerify', { verify: false });
    expect(await me(u)).toMatchObject({ emailVerified: false });
    await ctx.api().post('/auth/forgot-password', { email: u.email });
    await eventually(() =>
      expect(
        ctx.mailbox.extract(u.email, /reset-password\?token=([\w-]+)/),
      ).toBeTruthy(),
    );
    const token = ctx.mailbox.extract(
      u.email,
      /reset-password\?token=([\w-]+)/,
    )!;
    expect(
      (
        await ctx
          .api()
          .post('/auth/reset-password', { token, password: 'a-new-password-1' })
      ).status,
    ).toBe(204);
    const login = await ctx
      .api()
      .post('/auth/login', { email: u.email, password: 'a-new-password-1' });
    expect(login.body.user.emailVerified).toBe(true);
  });
});
