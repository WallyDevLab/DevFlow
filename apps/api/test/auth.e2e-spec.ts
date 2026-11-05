import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { createApp } from './helpers/app.js';
import { PASSWORD, signup, uid } from './helpers/factory.js';

type Ctx = Awaited<ReturnType<typeof createApp>>;
let ctx: Ctx;

beforeAll(async () => {
  ctx = await createApp();
});
afterAll(async () => {
  await ctx.app.close();
});

const refreshCookie = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('refresh_token='))!
    .split(';')[0];

const withCookie = (path: string, cookie: string) =>
  request(ctx.server).post(`/api/v1${path}`).set('Cookie', cookie);

const newCredentials = () => ({
  email: `user-${uid()}@example.com`,
  password: PASSWORD,
  name: 'Test User',
});

describe('registration', () => {
  it('creates an account and returns a session without leaking secrets', async () => {
    const body = newCredentials();
    const res = await ctx.api().post('/auth/register', body);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: body.email,
      name: 'Test User',
    });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refreshToken/);
  });

  it('delivers the refresh token only as an httpOnly, strict cookie scoped to /auth', async () => {
    const res = await ctx.api().post('/auth/register', newCredentials());
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(res.body).not.toHaveProperty('refreshToken');
  });

  it('stores passwords hashed, never in plain text', async () => {
    const body = newCredentials();
    await ctx.api().post('/auth/register', body);
    const row = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: body.email },
    });
    expect(row.passwordHash).not.toContain(body.password);
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt
  });

  it('normalises the email (trimmed, lower-case)', async () => {
    const body = newCredentials();
    const res = await ctx.api().post('/auth/register', {
      ...body,
      email: `  ${body.email.toUpperCase()} `,
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(body.email);
  });

  it('rejects a duplicate email', async () => {
    const body = newCredentials();
    await ctx.api().post('/auth/register', body);
    expect((await ctx.api().post('/auth/register', body)).status).toBe(409);
  });

  it.each([
    ['a short password', { password: 'short' }],
    ["a password over bcrypt's 72-byte limit", { password: 'x'.repeat(73) }],
    ['an invalid email', { email: 'not-an-email' }],
    ['a missing name', { name: '' }],
    ['unexpected fields', { isAdmin: true }],
  ])('rejects %s', async (_label, override) => {
    const res = await ctx
      .api()
      .post('/auth/register', { ...newCredentials(), ...override });
    expect(res.status).toBe(400);
  });
});

describe('login and sessions', () => {
  it('logs in with the right credentials', async () => {
    const user = await signup(ctx.api, 'Login');
    const res = await ctx
      .api()
      .post('/auth/login', { email: user.email, password: user.password });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
  });

  it('accepts the email in any case', async () => {
    const user = await signup(ctx.api, 'Case');
    const res = await ctx.api().post('/auth/login', {
      email: user.email.toUpperCase(),
      password: user.password,
    });
    expect(res.status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const user = await signup(ctx.api, 'Same');
    const wrong = await ctx
      .api()
      .post('/auth/login', { email: user.email, password: 'nope-nope-nope' });
    const unknown = await ctx.api().post('/auth/login', {
      email: `ghost-${uid()}@example.com`,
      password: PASSWORD,
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('protects /auth/me: no token, a malformed token and a forged token are all rejected', async () => {
    expect((await ctx.api().get('/auth/me')).status).toBe(401);
    expect((await ctx.api('garbage').get('/auth/me')).status).toBe(401);
    const forged = new JwtService({ secret: 'some-other-secret' }).sign({
      sub: 'x',
      email: 'x@y.z',
    });
    expect((await ctx.api(forged).get('/auth/me')).status).toBe(401);
  });

  it('rejects an expired access token', async () => {
    const user = await signup(ctx.api, 'Expired');
    const expired = ctx.app
      .get(JwtService)
      .sign({ sub: user.id, email: user.email }, { expiresIn: -10 });
    expect((await ctx.api(expired).get('/auth/me')).status).toBe(401);
  });

  it('returns the current user from /auth/me', async () => {
    const user = await signup(ctx.api, 'Me');
    const res = await ctx.api(user.token).get('/auth/me');
    expect(res.body).toEqual({
      id: user.id,
      email: user.email,
      name: 'Me',
      emailVerified: true,
    });
  });

  it('rotates the refresh token on use', async () => {
    const reg = await ctx.api().post('/auth/register', newCredentials());
    const first = refreshCookie(reg);
    const refreshed = await withCookie('/auth/refresh', first);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(refreshed)).not.toBe(first);
  });

  it('treats reuse of a rotated token as theft and revokes every session', async () => {
    const reg = await ctx.api().post('/auth/register', newCredentials());
    const stolen = refreshCookie(reg);
    const legit = refreshCookie(await withCookie('/auth/refresh', stolen)); // rotates
    expect((await withCookie('/auth/refresh', stolen)).status).toBe(401); // replay
    expect((await withCookie('/auth/refresh', legit)).status).toBe(401); // family killed
  });

  it('rejects a missing or unknown refresh token', async () => {
    expect((await ctx.api().post('/auth/refresh')).status).toBe(401);
    expect(
      (await withCookie('/auth/refresh', 'refresh_token=nonsense')).status,
    ).toBe(401);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const reg = await ctx.api().post('/auth/register', newCredentials());
    const cookie = refreshCookie(reg);
    const out = await withCookie('/auth/logout', cookie);
    expect(out.status).toBe(204);
    expect((await withCookie('/auth/refresh', cookie)).status).toBe(401);
  });

  it('only stores a hash of the refresh token', async () => {
    const reg = await ctx.api().post('/auth/register', newCredentials());
    const raw = refreshCookie(reg).split('=')[1];
    const plain = await ctx.prisma.refreshToken.count({
      where: { tokenHash: raw },
    });
    const hashed = await ctx.prisma.refreshToken.count({
      where: { tokenHash: createHash('sha256').update(raw).digest('hex') },
    });
    expect([plain, hashed]).toEqual([0, 1]);
  });
});

describe('rate limiting', () => {
  afterEach(() => {
    process.env.DISABLE_THROTTLE = 'true';
  });

  it('blocks repeated login attempts', async () => {
    process.env.DISABLE_THROTTLE = 'false';
    const email = `brute-${uid()}@example.com`;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push(
        (
          await ctx
            .api()
            .post('/auth/login', { email, password: 'wrong-wrong' })
        ).status,
      );
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});

describe('password reset', () => {
  it('answers identically for registered and unknown addresses, and only emails the real one', async () => {
    const user = await signup(ctx.api, 'Reset');
    const unknownEmail = `nobody-${uid()}@example.com`;
    const real = await ctx
      .api()
      .post('/auth/forgot-password', { email: user.email });
    const unknown = await ctx
      .api()
      .post('/auth/forgot-password', { email: unknownEmail });
    expect(real.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(real.body).toEqual(unknown.body);
    await vi.waitFor(() =>
      expect(ctx.mailbox.to(user.email, /reset/i)).toHaveLength(1),
    );
    expect(ctx.mailbox.to(unknownEmail)).toHaveLength(0);
  });

  it('emails a link, stores only its hash, and rate-limits repeat requests per account', async () => {
    const user = await signup(ctx.api, 'Hash');
    await ctx.api().post('/auth/forgot-password', { email: user.email });
    await ctx.api().post('/auth/forgot-password', { email: user.email }); // inside the cool-down
    await vi.waitFor(() =>
      expect(ctx.mailbox.to(user.email, /reset/i)).toHaveLength(1),
    );
    const token = ctx.mailbox.extract(
      user.email,
      /reset-password\?token=([\w-]+)/,
    )!;
    expect(token).toBeTruthy();
    expect(
      await ctx.prisma.passwordResetToken.count({
        where: { tokenHash: token },
      }),
    ).toBe(0);
    expect(
      await ctx.prisma.passwordResetToken.count({ where: { userId: user.id } }),
    ).toBe(1);
  });

  async function requestLink(user: { id: string; email: string }) {
    // Move any earlier token out of the cool-down window so a new one is issued.
    await ctx.prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 10 * 60_000) },
    });
    const before = ctx.mailbox.to(user.email).length;
    await ctx.api().post('/auth/forgot-password', { email: user.email });
    await vi.waitFor(() =>
      expect(ctx.mailbox.to(user.email).length).toBe(before + 1),
    );
    return ctx.mailbox.extract(user.email, /reset-password\?token=([\w-]+)/)!;
  }

  it('resets the password, once, and signs out existing sessions', async () => {
    const reg = await ctx.api().post('/auth/register', newCredentials());
    const { email } = reg.body.user;
    const oldCookie = refreshCookie(reg);
    const token = await requestLink({ id: reg.body.user.id, email });

    expect(
      (
        await ctx
          .api()
          .post('/auth/reset-password', { token, password: 'a-brand-new-pass' })
      ).status,
    ).toBe(204);
    expect(
      (await ctx.api().post('/auth/login', { email, password: PASSWORD }))
        .status,
    ).toBe(401);
    expect(
      (
        await ctx
          .api()
          .post('/auth/login', { email, password: 'a-brand-new-pass' })
      ).status,
    ).toBe(200);
    expect((await withCookie('/auth/refresh', oldCookie)).status).toBe(401);
    expect(
      (
        await ctx
          .api()
          .post('/auth/reset-password', { token, password: 'another-new-pass' })
      ).status,
    ).toBe(400);
    await vi.waitFor(() =>
      expect(
        ctx.mailbox
          .to(email)
          .some((m) => /password was changed/i.test(m.subject)),
      ).toBe(true),
    );
  });

  it('rejects unknown tokens and weak passwords without spending the token', async () => {
    const user = await signup(ctx.api, 'Weak');
    const token = await requestLink(user);
    expect(
      (
        await ctx.api().post('/auth/reset-password', {
          token: 'nonsense',
          password: 'long-enough-pw',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api()
          .post('/auth/reset-password', { token, password: 'short' })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api()
          .post('/auth/reset-password', { token, password: 'long-enough-pw' })
      ).status,
    ).toBe(204);
  });

  it('rejects an expired link', async () => {
    const user = await signup(ctx.api, 'Expire');
    const token = await requestLink(user);
    await ctx.prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await ctx
          .api()
          .post('/auth/reset-password', { token, password: 'long-enough-pw' })
      ).status,
    ).toBe(400);
  });

  it('only honours the newest link', async () => {
    const user = await signup(ctx.api, 'Newest');
    const older = await requestLink(user);
    const newer = await requestLink(user);
    expect(
      (
        await ctx.api().post('/auth/reset-password', {
          token: older,
          password: 'long-enough-pw',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.api().post('/auth/reset-password', {
          token: newer,
          password: 'long-enough-pw',
        })
      ).status,
    ).toBe(204);
  });
});

describe('account', () => {
  it('changes the password, keeping this device signed in and signing others out', async () => {
    const body = newCredentials();
    const first = await ctx.api().post('/auth/register', body);
    const otherDevice = refreshCookie(first);
    const thisDevice = await ctx
      .api()
      .post('/auth/login', { email: body.email, password: body.password });
    const token = thisDevice.body.accessToken as string;

    expect(
      (
        await ctx.api().post('/auth/change-password', {
          currentPassword: body.password,
          newPassword: 'x'.repeat(10),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await ctx.api(token).post('/auth/change-password', {
          currentPassword: 'wrong-wrong',
          newPassword: 'x'.repeat(10),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.api(token).post('/auth/change-password', {
          currentPassword: body.password,
          newPassword: body.password,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.api(token).post('/auth/change-password', {
          currentPassword: body.password,
          newPassword: 'short',
        })
      ).status,
    ).toBe(400);

    const changed = await ctx.api(token).post('/auth/change-password', {
      currentPassword: body.password,
      newPassword: 'x'.repeat(10),
    });
    expect(changed.status).toBe(200);
    expect((await withCookie('/auth/refresh', otherDevice)).status).toBe(401);
    // Presenting the stale cookie must not have killed the fresh session.
    expect(
      (await withCookie('/auth/refresh', refreshCookie(changed))).status,
    ).toBe(200);
  });

  it('updates the display name but never the email', async () => {
    const user = await signup(ctx.api, 'Profile');
    const ok = await ctx
      .api(user.token)
      .patch('/auth/me', { name: '  New Name  ' });
    expect(ok.body).toMatchObject({ name: 'New Name', email: user.email });
    expect(
      (await ctx.api(user.token).patch('/auth/me', { name: ' ' })).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api(user.token)
          .patch('/auth/me', { name: 'x', email: 'evil@example.com' })
      ).status,
    ).toBe(400);
    expect((await ctx.api().patch('/auth/me', { name: 'x' })).status).toBe(401);
  });
});
