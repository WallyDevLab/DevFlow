import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { LOCKOUT_MS, MAX_FAILED_LOGINS } from '../src/auth/auth.service.js';
import { createApp } from './helpers/app.js';
import { PASSWORD, signup, uid, workspaceWith } from './helpers/factory.js';
import { sendWebhook } from './helpers/mock-github.js';

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

const refreshCookie = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('refresh_token='))!
    .split(';')[0];

describe('response headers', () => {
  it('sends hardening headers and hides the framework', async () => {
    const res = await ctx.api().get('/auth/me');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
  });

  it('no longer serves the scaffold hello-world route', async () => {
    expect((await request(ctx.server).get('/api/v1')).status).toBe(404);
    expect((await request(ctx.server).get('/')).status).toBe(404);
  });
});

describe('CORS', () => {
  it('only ever allows the configured web origin', async () => {
    const evil = 'https://evil.example';
    const preflight = await request(ctx.server)
      .options('/api/v1/auth/login')
      .set('Origin', evil)
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).not.toBe(evil);
    const simple = await request(ctx.server)
      .post('/api/v1/auth/login')
      .set('Origin', evil)
      .send({ email: 'a@b.co', password: 'x'.repeat(8) });
    expect(simple.headers['access-control-allow-origin']).not.toBe(evil);
    expect(simple.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('request size limits', () => {
  const big = (kb: number) => ({
    email: 'a@b.co',
    password: 'x'.repeat(10),
    pad: 'y'.repeat(kb * 1024),
  });

  it('rejects oversized JSON on ordinary endpoints before processing it', async () => {
    const res = await request(ctx.server)
      .post('/api/v1/auth/login')
      .send(big(200));
    expect(res.status).toBe(413);
  });

  it('applies to authenticated endpoints too', async () => {
    const u = await signup(ctx.api, 'Big');
    const res = await request(ctx.server)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ name: 'ok name', pad: 'z'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
  });

  it('still accepts normal requests', async () => {
    const res = await request(ctx.server)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever-pw' });
    expect(res.status).toBe(401);
  });
});

describe('GitHub webhook endpoint', () => {
  it('accepts a large signed delivery (GitHub payloads can be big)', async () => {
    const res = await sendWebhook(ctx.server, 'ping', {
      zen: 'x',
      blob: 'x'.repeat(1_000_000),
    });
    expect(res.status).toBe(202);
  });

  it('rejects a large unsigned delivery without trusting it', async () => {
    const res = await sendWebhook(
      ctx.server,
      'ping',
      { blob: 'x'.repeat(1_000_000) },
      { sign: false },
    );
    expect(res.status).toBe(401);
  });

  it('refuses bodies over the webhook limit', async () => {
    const res = await sendWebhook(ctx.server, 'ping', {
      blob: 'x'.repeat(6 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it('verifies the signature before parsing: a signed non-JSON body is a 400, an unsigned one a 401', async () => {
    const { createHmac } = await import('node:crypto');
    const send = (body: string, signed: boolean) => {
      let req = request(ctx.server)
        .post('/api/v1/integrations/github/webhooks')
        .set('content-type', 'application/json')
        .set('x-github-event', 'ping')
        .set('x-github-delivery', `bad-${uid()}`);
      if (signed) {
        const sig = createHmac('sha256', 'whsec_test_secret')
          .update(body)
          .digest('hex');
        req = req.set('x-hub-signature-256', `sha256=${sig}`);
      }
      return req.send(body);
    };
    expect((await send('{not json', true)).status).toBe(400);
    expect((await send('{not json', false)).status).toBe(401);
    expect((await send('[1,2,3]', true)).status).toBe(400); // must be an object
    expect((await send('null', true)).status).toBe(400);
  });

  it('is rate limited, so it can’t be hammered without a signature', async () => {
    process.env.DISABLE_THROTTLE = 'false';
    const statuses: number[] = [];
    for (let i = 0; i < 620; i++) {
      statuses.push(
        (await sendWebhook(ctx.server, 'ping', {}, { sign: false })).status,
      );
    }
    expect(statuses.slice(0, 600).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(600).every((s) => s === 429)).toBe(true);
  });
});

describe('cookie endpoints refuse requests from other origins', () => {
  const post = (path: string, cookie: string, origin?: string) => {
    let req = request(ctx.server)
      .post(`/api/v1/auth${path}`)
      .set('Cookie', cookie);
    if (origin) req = req.set('Origin', origin);
    return req;
  };

  it('blocks refresh and logout from a foreign Origin, even with a valid cookie', async () => {
    const reg = await ctx.api().post('/auth/register', {
      email: `origin-${uid()}@example.com`,
      password: PASSWORD,
      name: 'Origin',
    });
    const cookie = refreshCookie(reg);
    expect(
      (await post('/refresh', cookie, 'https://evil.example')).status,
    ).toBe(403);
    expect((await post('/logout', cookie, 'https://evil.example')).status).toBe(
      403,
    );
    // The refused requests didn't consume or revoke the session.
    expect(
      (await post('/refresh', cookie, 'http://localhost:3000')).status,
    ).toBe(200);
  });

  it('allows the web app’s own origin and clients that send no Origin', async () => {
    const reg = await ctx.api().post('/auth/register', {
      email: `origin2-${uid()}@example.com`,
      password: PASSWORD,
      name: 'Origin',
    });
    const first = refreshCookie(reg);
    const second = await post('/refresh', first);
    expect(second.status).toBe(200);
    expect(
      (await post('/logout', refreshCookie(second), 'http://localhost:3000'))
        .status,
    ).toBe(204);
  });
});

describe('access tokens', () => {
  it('only accept the pinned algorithm (HS256)', async () => {
    const u = await signup(ctx.api, 'Alg');
    const jwt = ctx.app.get(JwtService);
    const hs384 = jwt.sign(
      { sub: u.id, email: u.email },
      { algorithm: 'HS384' },
    );
    expect((await ctx.api(hs384).get('/auth/me')).status).toBe(401);
    expect((await ctx.api(u.token).get('/auth/me')).status).toBe(200);
  });

  it('reject an unsigned ("alg: none") token', async () => {
    const u = await signup(ctx.api, 'None');
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, exp: 9_999_999_999 })}.`;
    expect((await ctx.api(forged).get('/auth/me')).status).toBe(401);
  });
});

describe('passwords', () => {
  const reg = (password: string) =>
    ctx.api().post('/auth/register', {
      email: `pw-${uid()}@example.com`,
      password,
      name: 'Pw',
    });

  it('are limited by bytes, because bcrypt ignores everything past byte 72', async () => {
    expect((await reg('😀'.repeat(18))).status).toBe(201); // exactly 72 bytes
    expect((await reg('😀'.repeat(19))).status).toBe(400); // 76 bytes, only 19 characters
    expect((await reg('x'.repeat(72))).status).toBe(201);
    expect((await reg('x'.repeat(73))).status).toBe(400);
  });

  it('use the same limit when signing in, resetting and changing', async () => {
    const u = await signup(ctx.api, 'Bytes');
    const long = '😀'.repeat(19);
    expect(
      (await ctx.api().post('/auth/login', { email: u.email, password: long }))
        .status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api()
          .post('/auth/reset-password', { token: 't', password: long })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.api(u.token).post('/auth/change-password', {
          currentPassword: u.password,
          newPassword: long,
        })
      ).status,
    ).toBe(400);
  });
});

describe('account lockout', () => {
  const login = (email: string, password: string) =>
    ctx.api().post('/auth/login', { email, password });
  const fail = async (email: string, times: number) => {
    for (let i = 0; i < times; i++) await login(email, 'wrong-password-x');
  };

  it('locks an account after repeated failures, answering exactly like a wrong password', async () => {
    const u = await signup(ctx.api, 'Lock');
    await fail(u.email, MAX_FAILED_LOGINS);
    const row = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: u.id },
    });
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(row.lockedUntil!.getTime()).toBeLessThanOrEqual(
      Date.now() + LOCKOUT_MS + 1000,
    );

    const lockedCorrect = await login(u.email, u.password);
    const wrong = await login(u.email, 'wrong-password-x');
    expect(lockedCorrect.status).toBe(401);
    expect(lockedCorrect.body).toEqual(wrong.body); // no hint that it is locked
  });

  it('doesn’t lock before the limit, and a success resets the count', async () => {
    const u = await signup(ctx.api, 'Reset');
    await fail(u.email, MAX_FAILED_LOGINS - 1);
    expect((await login(u.email, u.password)).status).toBe(200);
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.id } }))
        .failedLogins,
    ).toBe(0);
    await fail(u.email, MAX_FAILED_LOGINS - 1); // would have locked without the reset
    expect((await login(u.email, u.password)).status).toBe(200);
  });

  it('expires on its own', async () => {
    const u = await signup(ctx.api, 'Expire');
    await fail(u.email, MAX_FAILED_LOGINS);
    expect((await login(u.email, u.password)).status).toBe(401);
    await ctx.prisma.user.update({
      where: { id: u.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    expect((await login(u.email, u.password)).status).toBe(200);
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.id } }))
        .lockedUntil,
    ).toBeNull();
  });

  it('is cleared by resetting the password (the recovery path)', async () => {
    const u = await signup(ctx.api, 'Recover');
    await fail(u.email, MAX_FAILED_LOGINS);
    await ctx.api().post('/auth/forgot-password', { email: u.email });
    await vi.waitFor(() =>
      expect(ctx.mailbox.to(u.email, /reset/i).length).toBeGreaterThan(0),
    );
    const token = ctx.mailbox.extract(
      u.email,
      /reset-password\?token=([\w-]+)/,
    )!;
    expect(
      (
        await ctx
          .api()
          .post('/auth/reset-password', { token, password: 'a-fresh-password' })
      ).status,
    ).toBe(204);
    expect((await login(u.email, 'a-fresh-password')).status).toBe(200);
  });

  it('only affects the targeted account', async () => {
    const [victim, other] = await Promise.all([
      signup(ctx.api, 'Victim'),
      signup(ctx.api, 'Other'),
    ]);
    await fail(victim.email, MAX_FAILED_LOGINS);
    expect((await login(other.email, other.password)).status).toBe(200);
  });

  it('ignores attempts against addresses that don’t exist', async () => {
    const res = await login(`ghost-${uid()}@example.com`, 'wrong-password-x');
    expect(res.status).toBe(401);
  });
});

describe('single-line fields', () => {
  it('strip line breaks from names that are copied into emails and notifications', async () => {
    const res = await ctx.api().post('/auth/register', {
      email: `nl-${uid()}@example.com`,
      password: PASSWORD,
      name: 'Evil\r\nBcc: victim@example.com\u2028 Person\t!',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.name).toBe('Evil Bcc: victim@example.com Person !');
    expect(res.body.user.name).not.toMatch(/[\r\n\t\u2028]/);
  });

  it('apply to workspace names, and so to invitation email subjects', async () => {
    const owner = await signup(ctx.api, 'Owner');
    const ws = await workspaceWith(
      ctx.api,
      owner,
      [],
      'Team\r\nSubject: spoof',
    );
    const invitee = `inv-${uid()}@example.com`;
    await ctx.api(owner.token).post(`/workspaces/${ws}/invitations`, {
      email: invitee,
      role: 'VIEWER',
    });
    const mail = ctx.mailbox.to(invitee)[0];
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toContain('Team Subject: spoof');
  });

  it('still allow multi-line comments and descriptions', async () => {
    const owner = await signup(ctx.api, 'Multi');
    const ws = await workspaceWith(ctx.api, owner, []);
    const project = (
      await ctx
        .api(owner.token)
        .post(`/workspaces/${ws}/projects`, { name: 'Multi', key: 'ML' })
    ).body.id;
    const task = (
      await ctx.api(owner.token).post(`/projects/${project}/tasks`, {
        title: 'T',
        description: 'line one\nline two',
      })
    ).body.id;
    await ctx
      .api(owner.token)
      .post(`/tasks/${task}/comments`, { body: 'a\nb' });
    const comment = (await ctx.api(owner.token).get(`/tasks/${task}/comments`))
      .body[0];
    expect(comment.body).toBe('a\nb');
    expect(
      (await ctx.api(owner.token).get(`/tasks/${task}`)).body.description,
    ).toBe('line one\nline two');
  });
});

describe('rate limiting behind a proxy', () => {
  const attempt = (server: Ctx['server'], ip: string) =>
    request(server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: `rl-${uid()}@example.com`, password: 'wrong-password-x' });

  async function burst(server: Ctx['server'], ip: string) {
    const out: number[] = [];
    for (let i = 0; i < 6; i++) out.push((await attempt(server, ip)).status);
    return out;
  }

  it('can’t be bypassed by spoofing X-Forwarded-For when no proxy is trusted', async () => {
    process.env.DISABLE_THROTTLE = 'false';
    // Every request really comes from the same address, whatever it claims.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await attempt(ctx.server, `203.0.113.${i + 1}`)).status);
    expect(statuses[5]).toBe(429);
  });

  it('keys the limit on the real client address when a proxy is trusted', async () => {
    process.env.TRUST_PROXY = '1';
    const proxied = await createApp();
    try {
      process.env.DISABLE_THROTTLE = 'false';
      const a = await burst(proxied.server, '198.51.100.10');
      const b = await attempt(proxied.server, '198.51.100.20');
      expect(a[5]).toBe(429); // that client is limited
      expect(b.status).toBe(401); // a different client is not
    } finally {
      delete process.env.TRUST_PROXY;
      await proxied.app.close();
    }
  });
});
