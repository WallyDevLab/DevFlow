import { randomUUID } from 'node:crypto';
import type { Api } from './app.js';

export const PASSWORD = 'correct-horse-battery';
export const uid = () => randomUUID().slice(0, 8);

export interface TestUser {
  id: string;
  name: string;
  email: string;
  token: string;
  password: string;
}

/** Completes email verification the way a user would: by following the emailed link. */
export async function verifyEmail(api: Api, user: { email: string }) {
  await eventually(() => {
    if (!api.mailbox.extract(user.email, /verify-email\?token=([\w-]+)/)) {
      throw new Error('verification email not sent yet');
    }
  });
  const token = api.mailbox.extract(
    user.email,
    /verify-email\?token=([\w-]+)/,
  )!;
  const res = await api().post('/auth/verify-email', { token });
  if (res.status !== 204) throw new Error(`verification failed: ${res.status}`);
}

/**
 * Registers a new account with a unique email. The address is verified by
 * default (most tests need to accept invitations); pass `{ verify: false }` to
 * test the unverified state.
 */
export async function signup(
  api: Api,
  name: string,
  opts: { verify?: boolean } = {},
): Promise<TestUser> {
  const email = `${name.toLowerCase()}-${uid()}@example.com`;
  const res = await api().post('/auth/register', {
    email,
    password: PASSWORD,
    name,
  });
  if (res.status !== 201) {
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  if (opts.verify !== false) await verifyEmail(api, { email });
  return {
    id: res.body.user.id,
    name,
    email,
    token: res.body.accessToken,
    password: PASSWORD,
  };
}

export type Role =
  'ADMIN' | 'SCRUM_MASTER' | 'PRODUCT_OWNER' | 'DEVELOPER' | 'VIEWER';

/** A workspace owned by `owner`, with each given user invited and joined. */
export async function workspaceWith(
  api: Api,
  owner: TestUser,
  members: [TestUser, Role][] = [],
  name = 'Test Workspace',
) {
  const res = await api(owner.token).post('/workspaces', { name });
  const workspaceId: string = res.body.id;
  for (const [user, role] of members) {
    const inv = await api(owner.token).post(
      `/workspaces/${workspaceId}/invitations`,
      {
        email: user.email,
        role,
      },
    );
    const accepted = await api(user.token).post('/invitations/accept', {
      token: inv.body.token,
    });
    if (accepted.status !== 200) throw new Error('invite accept failed');
  }
  return workspaceId;
}

export async function projectIn(
  api: Api,
  owner: TestUser,
  workspaceId: string,
  key = 'TST',
) {
  const res = await api(owner.token).post(
    `/workspaces/${workspaceId}/projects`,
    {
      name: `Project ${key}`,
      key,
    },
  );
  if (res.status !== 201)
    throw new Error(`project failed: ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

export async function taskIn(
  api: Api,
  user: TestUser,
  projectId: string,
  body: Record<string, unknown> = {},
) {
  const res = await api(user.token).post(`/projects/${projectId}/tasks`, {
    title: 'A task',
    ...body,
  });
  if (res.status !== 201)
    throw new Error(`task failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: string; key: string };
}

export async function statusesOf(api: Api, user: TestUser, projectId: string) {
  const res = await api(user.token).get(`/projects/${projectId}`);
  return res.body.statuses as { id: string; name: string; category: string }[];
}

export const statusId = async (
  api: Api,
  user: TestUser,
  projectId: string,
  name: string,
) => (await statusesOf(api, user, projectId)).find((s) => s.name === name)!.id;

/** Retries an assertion until it passes (for background processing like webhooks). */
export async function eventually(
  fn: () => Promise<void> | void,
  timeoutMs = 4000,
) {
  const start = Date.now();
  for (;;) {
    try {
      await fn();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await new Promise((r) => setTimeout(r, 75));
    }
  }
}
