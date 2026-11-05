import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';

export const WEBHOOK_SECRET = 'whsec_test_secret';

export const MOCK_REPOS = [
  { id: 1001, full_name: 'acme/platform', private: true },
  { id: 1002, full_name: 'acme/website', private: false },
];

/**
 * A tiny stand-in for the parts of GitHub the app talks to. It verifies the
 * app's RS256 JWT, the OAuth code exchange and installation tokens, and
 * records every call so tests can assert on what the app did.
 */
export async function startMockGitHub() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const pub = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const calls: string[] = [];
  const config = { visibleInstallations: [777], uninstallStatus: 204 };

  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? '';
    calls.push(`${req.method} ${req.url}`);
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const appJwtValid = () => {
      const t = auth.replace('Bearer ', '').split('.');
      if (t.length !== 3) return false;
      const claims = JSON.parse(Buffer.from(t[1], 'base64url').toString());
      const ok = createVerify('RSA-SHA256')
        .update(`${t[0]}.${t[1]}`)
        .verify(pub, Buffer.from(t[2], 'base64url'));
      return ok && claims.iss === '424242' && claims.exp > Date.now() / 1000;
    };
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url ?? '';
      if (url === '/login/oauth/access_token') {
        const { code, client_id, client_secret } = JSON.parse(body);
        return code === 'goodcode' &&
          client_id === 'Iv1.test' &&
          client_secret === 'csecret'
          ? json(200, { access_token: 'gho_user' })
          : json(200, { error: 'bad_verification_code' });
      }
      if (url.startsWith('/user/installations')) {
        return auth === 'Bearer gho_user'
          ? json(200, {
              installations: config.visibleInstallations.map((id) => ({ id })),
            })
          : json(401, {});
      }
      if (url.startsWith('/app/')) {
        if (!appJwtValid()) return json(401, { message: 'bad jwt' });
        if (req.method === 'POST' && url.endsWith('access_tokens')) {
          return json(201, {
            token: 'ghs_install',
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          });
        }
        if (req.method === 'DELETE') return json(config.uninstallStatus, {});
        return json(200, {
          id: 777,
          account: { login: 'acme', type: 'Organization' },
        });
      }
      if (url.startsWith('/installation/repositories')) {
        return auth === 'Bearer ghs_install'
          ? json(200, { repositories: MOCK_REPOS })
          : json(401, {});
      }
      json(404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;

  return {
    url,
    calls,
    config,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    /** Environment that points the app at this mock. */
    env: (): Record<string, string> => ({
      GITHUB_APP_ID: '424242',
      GITHUB_APP_SLUG: 'devflow-test',
      GITHUB_CLIENT_ID: 'Iv1.test',
      GITHUB_CLIENT_SECRET: 'csecret',
      GITHUB_API_URL: url,
      GITHUB_WEB_URL: url,
      GITHUB_APP_PRIVATE_KEY: privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }) as string,
    }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Posts a signed webhook delivery, like GitHub would. */
export function sendWebhook(
  server: http.Server,
  event: string,
  payload: object,
  opts: { delivery?: string; secret?: string; sign?: boolean } = {},
) {
  const raw = JSON.stringify(payload);
  let req = request(server)
    .post('/api/v1/integrations/github/webhooks')
    .set('content-type', 'application/json')
    .set('x-github-event', event)
    .set(
      'x-github-delivery',
      opts.delivery ?? `d-${Math.random().toString(36).slice(2)}`,
    );
  if (opts.sign !== false) {
    req = req.set(
      'x-hub-signature-256',
      `sha256=${createHmac('sha256', opts.secret ?? WEBHOOK_SECRET)
        .update(raw)
        .digest('hex')}`,
    );
  }
  return req.send(raw);
}

/** A pull_request payload linked to installation 777 / repo 1001 by default. */
export function pullRequestPayload(
  action: string,
  over: {
    number?: number;
    branch?: string;
    title?: string;
    sha?: string;
    merged?: boolean;
    repo?: number;
    installation?: number;
  } = {},
) {
  return {
    action,
    installation: { id: over.installation ?? 777 },
    repository: { id: over.repo ?? 1001 },
    pull_request: {
      number: over.number ?? 42,
      title: over.title ?? 'Implement authentication API',
      body: '',
      state: action === 'closed' ? 'closed' : 'open',
      draft: false,
      merged: over.merged ?? false,
      html_url: `https://github.com/acme/platform/pull/${over.number ?? 42}`,
      head: { ref: over.branch ?? 'feature/main', sha: over.sha ?? 'sha1' },
      user: { login: 'octocat' },
      created_at: '2026-11-04T10:00:00Z',
      merged_at: over.merged ? '2026-11-04T12:00:00Z' : null,
    },
  };
}
