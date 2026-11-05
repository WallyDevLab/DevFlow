import { createSign } from 'node:crypto';
import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GitHubRepo {
  id: number;
  full_name: string;
  private: boolean;
}

const b64url = (input: string | Buffer) =>
  Buffer.from(input).toString('base64url');

/**
 * Minimal GitHub App client. Credentials come from the environment only; app
 * JWTs and installation tokens are minted on demand, kept in memory, and never
 * logged, persisted or sent to the browser.
 */
@Injectable()
export class GitHubApiService {
  private readonly tokens = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(private readonly config: ConfigService) {}

  private get(name: string) {
    return this.config.get<string>(name)?.trim() || undefined;
  }

  get apiUrl() {
    return this.get('GITHUB_API_URL') ?? 'https://api.github.com';
  }
  get webUrl() {
    return this.get('GITHUB_WEB_URL') ?? 'https://github.com';
  }
  get slug() {
    return this.get('GITHUB_APP_SLUG');
  }
  get webhookSecret() {
    return this.get('GITHUB_WEBHOOK_SECRET');
  }

  /** True when every setting needed for the install flow is present. */
  get configured() {
    return Boolean(
      this.get('GITHUB_APP_ID') &&
      this.get('GITHUB_APP_PRIVATE_KEY') &&
      this.get('GITHUB_APP_SLUG') &&
      this.get('GITHUB_CLIENT_ID') &&
      this.get('GITHUB_CLIENT_SECRET') &&
      this.get('GITHUB_WEBHOOK_SECRET'),
    );
  }

  private appJwt() {
    const key = this.get('GITHUB_APP_PRIVATE_KEY')!.replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = b64url(
      JSON.stringify({
        iat: now - 60,
        exp: now + 9 * 60,
        iss: this.get('GITHUB_APP_ID'),
      }),
    );
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key);
    return `${head}.${body}.${b64url(sig)}`;
  }

  private async call<T>(
    path: string,
    init: { method?: string; token: string; body?: unknown; base?: string },
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${init.base ?? this.apiUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${init.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'devflow',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException('Could not reach GitHub');
    }
    if (res.status === 204) return undefined as T;
    if (!res.ok)
      throw new BadGatewayException(`GitHub responded with ${res.status}`);
    return (await res.json()) as T;
  }

  async installationToken(installationId: number | bigint): Promise<string> {
    const key = String(installationId);
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const res = await this.call<{ token: string; expires_at: string }>(
      `/app/installations/${key}/access_tokens`,
      { method: 'POST', token: this.appJwt() },
    );
    this.tokens.set(key, {
      token: res.token,
      expiresAt: Date.parse(res.expires_at),
    });
    return res.token;
  }

  async listRepositories(
    installationId: number | bigint,
  ): Promise<GitHubRepo[]> {
    const token = await this.installationToken(installationId);
    const repos: GitHubRepo[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await this.call<{ repositories: GitHubRepo[] }>(
        `/installation/repositories?per_page=100&page=${page}`,
        { token },
      );
      repos.push(...res.repositories);
      if (res.repositories.length < 100) break;
    }
    return repos;
  }

  getInstallation(installationId: number) {
    return this.call<{ id: number; account: { login: string; type: string } }>(
      `/app/installations/${installationId}`,
      { token: this.appJwt() },
    );
  }

  /** Revokes the app's access on GitHub's side. */
  async uninstall(installationId: number | bigint) {
    await this.call(`/app/installations/${installationId}`, {
      method: 'DELETE',
      token: this.appJwt(),
    });
    this.tokens.delete(String(installationId));
  }

  async exchangeCode(code: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.webUrl}/login/oauth/access_token`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.get('GITHUB_CLIENT_ID'),
          client_secret: this.get('GITHUB_CLIENT_SECRET'),
          code,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException('Could not reach GitHub');
    }
    const json = (await res.json().catch(() => null)) as {
      access_token?: string;
    } | null;
    if (!json?.access_token) return '';
    return json.access_token;
  }

  async userInstallationIds(userToken: string): Promise<number[]> {
    const res = await this.call<{ installations: { id: number }[] }>(
      '/user/installations?per_page=100',
      { token: userToken },
    );
    return res.installations.map((i) => i.id);
  }
}
