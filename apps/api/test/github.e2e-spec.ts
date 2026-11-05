import { createApp } from './helpers/app.js';
import {
  eventually,
  projectIn,
  signup,
  taskIn,
  workspaceWith,
  type TestUser,
} from './helpers/factory.js';
import {
  pullRequestPayload,
  sendWebhook,
  startMockGitHub,
} from './helpers/mock-github.js';

type Ctx = Awaited<ReturnType<typeof createApp>>;
let ctx: Ctx;
let github: Awaited<ReturnType<typeof startMockGitHub>>;
const savedEnv: Record<string, string | undefined> = {};

let owner: TestUser, dev: TestUser, outsider: TestUser;
let ws: string, project: string, task: { id: string; key: string };

beforeAll(async () => {
  github = await startMockGitHub();
  for (const [k, v] of Object.entries(github.env())) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  ctx = await createApp();
  [owner, dev, outsider] = await Promise.all(
    ['Owner', 'Dev', 'Outsider'].map((n) => signup(ctx.api, n)),
  );
  ws = await workspaceWith(ctx.api, owner, [[dev, 'DEVELOPER']]);
  project = await projectIn(ctx.api, owner, ws, 'GH');
  task = await taskIn(ctx.api, dev, project, { title: 'Auth API' });
});
afterAll(async () => {
  await ctx.app.close();
  await github.close();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const status = async (u: TestUser) =>
  (await ctx.api(u.token).get(`/workspaces/${ws}/integrations/github`)).body;
const stateFromUrl = (installUrl: string) =>
  new URL(installUrl).searchParams.get('state')!;
const complete = (u: TestUser, body: object) =>
  ctx.api(u.token).post('/integrations/github/installations', body);
const taskView = async () =>
  (await ctx.api(owner.token).get(`/tasks/${task.id}`)).body;

describe('connecting GitHub', () => {
  it('offers an install URL only to managers, and only when configured', async () => {
    const s = await status(owner);
    expect(s).toMatchObject({ configured: true, canManage: true });
    expect(s.installUrl).toContain(
      '/apps/devflow-test/installations/new?state=',
    );
    expect(await status(dev)).toMatchObject({
      canManage: false,
      installUrl: null,
    });
    expect(
      (
        await ctx
          .api(outsider.token)
          .get(`/workspaces/${ws}/integrations/github`)
      ).status,
    ).toBe(404);
  });

  it('rejects a tampered, foreign or garbage state', async () => {
    const state = stateFromUrl((await status(owner)).installUrl);
    const good = { installationId: 777, code: 'goodcode' };
    expect(
      (await complete(owner, { ...good, state: state.slice(0, -3) + 'abc' }))
        .status,
    ).toBe(400);
    expect((await complete(owner, { ...good, state: 'garbage' })).status).toBe(
      400,
    );
    expect((await complete(outsider, { ...good, state })).status).toBe(403); // a different user
  });

  it('rejects a bad OAuth code', async () => {
    const state = stateFromUrl((await status(owner)).installUrl);
    expect(
      (await complete(owner, { installationId: 777, code: 'wrong', state }))
        .status,
    ).toBe(403);
  });

  it('won’t attach an installation the signed-in GitHub user can’t see', async () => {
    const state = stateFromUrl((await status(owner)).installUrl);
    expect(
      (await complete(owner, { installationId: 888, code: 'goodcode', state }))
        .status,
    ).toBe(403);
  });

  it('connects with a valid state, code and visible installation', async () => {
    const state = stateFromUrl((await status(owner)).installUrl);
    const res = await complete(owner, {
      installationId: 777,
      code: 'goodcode',
      state,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ workspaceId: ws, accountLogin: 'acme' });
    expect(await status(owner)).toMatchObject({
      installation: { accountLogin: 'acme' },
      installUrl: null,
    });
  });

  it('authenticates to GitHub as the app (RS256) when listing repositories', async () => {
    const repos = (
      await ctx
        .api(owner.token)
        .get(`/workspaces/${ws}/integrations/github/repositories`)
    ).body;
    expect(repos.map((r: { fullName: string }) => r.fullName)).toEqual([
      'acme/platform',
      'acme/website',
    ]);
    expect(github.calls).toContain('POST /app/installations/777/access_tokens'); // the mock verified our JWT
  });

  it('lets only managers list and link repositories', async () => {
    expect(
      (
        await ctx
          .api(dev.token)
          .get(`/workspaces/${ws}/integrations/github/repositories`)
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx
          .api(dev.token)
          .put(`/projects/${project}/repository`, { fullName: 'acme/platform' })
      ).status,
    ).toBe(403);
  });

  it('links only repositories the installation can access, one project per repository', async () => {
    expect(
      (
        await ctx
          .api(owner.token)
          .put(`/projects/${project}/repository`, { fullName: 'evil/other' })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api(owner.token)
          .put(`/projects/${project}/repository`, { fullName: 'acme/platform' })
      ).status,
    ).toBe(200);
    const second = await projectIn(ctx.api, owner, ws, 'G2');
    expect(
      (
        await ctx
          .api(owner.token)
          .put(`/projects/${second}/repository`, { fullName: 'acme/platform' })
      ).status,
    ).toBe(409);
    expect(
      (await ctx.api(owner.token).get(`/projects/${project}`)).body.repository,
    ).toBe('acme/platform');
  });
});

describe('webhook security', () => {
  it('rejects deliveries with no or a wrong signature, storing nothing', async () => {
    const before = await ctx.prisma.webhookEvent.count();
    expect(
      (
        await sendWebhook(
          ctx.server,
          'pull_request',
          pullRequestPayload('opened'),
          { sign: false },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await sendWebhook(
          ctx.server,
          'pull_request',
          pullRequestPayload('opened'),
          { secret: 'wrong' },
        )
      ).status,
    ).toBe(401);
    expect(await ctx.prisma.webhookEvent.count()).toBe(before);
  });

  it('rejects a signature computed over a different body', async () => {
    const raw = JSON.stringify(pullRequestPayload('opened'));
    const res = await ctx
      .api()
      .post('/integrations/github/webhooks')
      .set('content-type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-github-delivery', 'tamper-1')
      .set('x-hub-signature-256', 'sha256=' + '0'.repeat(64))
      .send(raw);
    expect(res.status).toBe(401);
  });

  it('requires the event and delivery headers', async () => {
    const raw = JSON.stringify({});
    const { createHmac } = await import('node:crypto');
    const sig =
      'sha256=' +
      createHmac('sha256', 'whsec_test_secret').update(raw).digest('hex');
    const res = await ctx
      .api()
      .post('/integrations/github/webhooks')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sig)
      .send(raw);
    expect(res.status).toBe(400);
  });
});

describe('pull request tracking', () => {
  it('links a PR to the task named in its branch and shows it on the task', async () => {
    const res = await sendWebhook(
      ctx.server,
      'pull_request',
      pullRequestPayload('opened', {
        branch: `feature/${task.key}-auth-api`,
        sha: 'aaa',
      }),
      { delivery: 'pr-open' },
    );
    expect(res.status).toBe(202);
    await eventually(async () => {
      const t = await taskView();
      expect(t.pullRequests).toHaveLength(1);
      expect(t.pullRequests[0]).toMatchObject({
        number: 42,
        state: 'open',
        merged: false,
        repository: 'acme/platform',
      });
      expect(
        t.activity.some(
          (a: { type: string; actor: string }) =>
            a.type === 'pr_linked' && a.actor === 'GitHub',
        ),
      ).toBe(true);
    });
  });

  it('ignores a redelivered event instead of duplicating records', async () => {
    const dup = await sendWebhook(
      ctx.server,
      'pull_request',
      pullRequestPayload('opened', {
        branch: `feature/${task.key}-auth-api`,
        sha: 'aaa',
      }),
      { delivery: 'pr-open' },
    );
    expect(dup.body).toEqual({ duplicate: true });
    const t = await taskView();
    expect(t.pullRequests).toHaveLength(1);
    expect(
      t.activity.filter((a: { type: string }) => a.type === 'pr_linked'),
    ).toHaveLength(1);
  });

  it('records processing status per delivery', async () => {
    await eventually(async () => {
      const row = await ctx.prisma.webhookEvent.findUniqueOrThrow({
        where: { deliveryId: 'pr-open' },
      });
      expect(row.status).toBe('PROCESSED');
    });
  });

  it('tracks reviews, ignoring plain comments', async () => {
    const base = {
      installation: { id: 777 },
      repository: { id: 1001 },
      pull_request: { number: 42 },
    };
    await sendWebhook(ctx.server, 'pull_request_review', {
      ...base,
      action: 'submitted',
      review: { state: 'COMMENTED' },
    });
    await sendWebhook(ctx.server, 'pull_request_review', {
      ...base,
      action: 'submitted',
      review: { state: 'APPROVED' },
    });
    await eventually(async () =>
      expect((await taskView()).pullRequests[0].reviewState).toBe('approved'),
    );
    await sendWebhook(ctx.server, 'pull_request_review', {
      ...base,
      action: 'submitted',
      review: { state: 'CHANGES_REQUESTED' },
    });
    await eventually(async () =>
      expect((await taskView()).pullRequests[0].reviewState).toBe(
        'changes_requested',
      ),
    );
    await sendWebhook(ctx.server, 'pull_request_review', {
      ...base,
      action: 'dismissed',
      review: { state: 'DISMISSED' },
    });
    await eventually(async () =>
      expect((await taskView()).pullRequests[0].reviewState).toBeNull(),
    );
  });

  it('tracks CI status per commit, and resets it when new commits arrive', async () => {
    const suite = (conclusion: string | null, status = 'completed') =>
      sendWebhook(ctx.server, 'check_suite', {
        action: 'completed',
        installation: { id: 777 },
        repository: { id: 1001 },
        check_suite: { head_sha: 'aaa', status, conclusion },
      });
    await suite('success');
    await eventually(async () =>
      expect((await taskView()).pullRequests[0].checksState).toBe('success'),
    );
    await suite(null, 'in_progress');
    await eventually(async () =>
      expect((await taskView()).pullRequests[0].checksState).toBe('pending'),
    );
    await suite('failure');
    await eventually(async () =>
      expect((await taskView()).pullRequests[0].checksState).toBe('failure'),
    );
    await sendWebhook(
      ctx.server,
      'pull_request',
      pullRequestPayload('synchronize', {
        branch: `feature/${task.key}-auth-api`,
        sha: 'bbb',
      }),
    );
    await eventually(async () =>
      expect((await taskView()).pullRequests[0].checksState).toBe('pending'),
    );
  });

  it('records the merge on the PR and in the task history', async () => {
    await sendWebhook(
      ctx.server,
      'pull_request',
      pullRequestPayload('closed', {
        branch: `feature/${task.key}-auth-api`,
        merged: true,
        sha: 'bbb',
      }),
    );
    await eventually(async () => {
      const t = await taskView();
      expect(t.pullRequests[0]).toMatchObject({
        merged: true,
        state: 'closed',
      });
      expect(
        t.activity.some((a: { type: string }) => a.type === 'pr_merged'),
      ).toBe(true);
    });
  });

  it('matches the key in the title too, and ignores keys from other projects', async () => {
    const other = await taskIn(ctx.api, dev, project, { title: 'Second' });
    await sendWebhook(
      ctx.server,
      'pull_request',
      pullRequestPayload('opened', {
        number: 50,
        branch: 'fix/typo',
        title: `Fix ${other.key} flake`,
      }),
    );
    await sendWebhook(
      ctx.server,
      'pull_request',
      pullRequestPayload('opened', {
        number: 51,
        branch: 'chore/NOPE-1-x',
        title: 'Unrelated',
      }),
    );
    await eventually(async () => {
      expect(
        (
          await ctx.api(owner.token).get(`/tasks/${other.id}`)
        ).body.pullRequests.map((p: { number: number }) => p.number),
      ).toEqual([50]);
    });
    await eventually(async () => {
      expect(
        await ctx.prisma.pullRequest.count({ where: { number: 51 } }),
      ).toBe(1);
      expect(
        (
          await ctx.prisma.pullRequest.findFirstOrThrow({
            where: { number: 51 },
          })
        ).taskId,
      ).toBeNull();
    });
  });

  it('ignores events for unlinked repositories and from the wrong installation', async () => {
    await sendWebhook(
      ctx.server,
      'pull_request',
      pullRequestPayload('opened', { number: 90, repo: 9999 }),
    );
    await sendWebhook(
      ctx.server,
      'pull_request',
      pullRequestPayload('opened', { number: 91, installation: 31337 }),
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(
      await ctx.prisma.pullRequest.count({
        where: { number: { in: [90, 91] } },
      }),
    ).toBe(0);
  });

  it('keeps failing events retriable (failed deliveries are reprocessed on redelivery)', async () => {
    await ctx.prisma.webhookEvent.create({
      data: {
        deliveryId: 'stuck-1',
        event: 'pull_request',
        status: 'FAILED',
        error: 'boom',
      },
    });
    const res = await sendWebhook(
      ctx.server,
      'pull_request',
      pullRequestPayload('opened', { number: 60, branch: `x/${task.key}` }),
      { delivery: 'stuck-1' },
    );
    expect(res.body).toEqual({ duplicate: false });
    await eventually(async () =>
      expect(
        (
          await ctx.prisma.webhookEvent.findUniqueOrThrow({
            where: { deliveryId: 'stuck-1' },
          })
        ).status,
      ).toBe('PROCESSED'),
    );
  });
});

describe('disconnecting', () => {
  it('unlinks repositories when GitHub removes them from the installation', async () => {
    await sendWebhook(ctx.server, 'installation_repositories', {
      action: 'removed',
      installation: { id: 777 },
      repositories_removed: [{ id: 1001 }],
    });
    await eventually(async () =>
      expect(
        (await ctx.api(owner.token).get(`/projects/${project}`)).body
          .repository,
      ).toBeNull(),
    );
    await ctx
      .api(owner.token)
      .put(`/projects/${project}/repository`, { fullName: 'acme/platform' }); // relink for the next test
  });

  it('lets only managers disconnect, revoking access on GitHub and removing local data', async () => {
    expect(
      (await ctx.api(dev.token).delete(`/workspaces/${ws}/integrations/github`))
        .status,
    ).toBe(403);
    const res = await ctx
      .api(owner.token)
      .delete(`/workspaces/${ws}/integrations/github`);
    expect(res.body).toEqual({ revokedOnGitHub: true });
    expect(github.calls).toContain('DELETE /app/installations/777');
    expect(
      (await ctx.api(owner.token).get(`/projects/${project}`)).body.repository,
    ).toBeNull();
    expect(
      await ctx.prisma.pullRequest.count({
        where: { repository: { projectId: project } },
      }),
    ).toBe(0);
    expect(
      (
        await ctx
          .api(owner.token)
          .get(`/workspaces/${ws}/integrations/github/repositories`)
      ).status,
    ).toBe(404);
  });

  it('still disconnects locally if GitHub can’t be reached, and says so', async () => {
    const state = stateFromUrl((await status(owner)).installUrl);
    await complete(owner, { installationId: 777, code: 'goodcode', state });
    github.config.uninstallStatus = 500;
    const res = await ctx
      .api(owner.token)
      .delete(`/workspaces/${ws}/integrations/github`);
    github.config.uninstallStatus = 204;
    expect(res.body).toEqual({ revokedOnGitHub: false });
    expect((await status(owner)).installation).toBeNull();
  });

  it('removes the installation when GitHub says it was uninstalled', async () => {
    const state = stateFromUrl((await status(owner)).installUrl);
    await complete(owner, { installationId: 777, code: 'goodcode', state });
    await sendWebhook(ctx.server, 'installation', {
      action: 'deleted',
      installation: { id: 777 },
    });
    await eventually(async () =>
      expect((await status(owner)).installation).toBeNull(),
    );
  });

  it('refuses to attach one GitHub installation to two workspaces', async () => {
    const stateA = stateFromUrl((await status(owner)).installUrl);
    expect(
      (
        await complete(owner, {
          installationId: 777,
          code: 'goodcode',
          state: stateA,
        })
      ).status,
    ).toBe(200);
    const other = await signup(ctx.api, 'Other');
    const ws2 = await workspaceWith(ctx.api, other, [], 'Other WS');
    const stateB = stateFromUrl(
      (await ctx.api(other.token).get(`/workspaces/${ws2}/integrations/github`))
        .body.installUrl,
    );
    expect(
      (
        await complete(other, {
          installationId: 777,
          code: 'goodcode',
          state: stateB,
        })
      ).status,
    ).toBe(409);
  });
});

describe('when GitHub isn’t configured', () => {
  it('reports it and offers no install URL', async () => {
    const saved = process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_ID;
    const solo = await signup(ctx.api, 'Solo');
    const w = await workspaceWith(ctx.api, solo, []);
    const res = await ctx
      .api(solo.token)
      .get(`/workspaces/${w}/integrations/github`);
    process.env.GITHUB_APP_ID = saved;
    expect(res.body).toMatchObject({ configured: false, installUrl: null });
  });
});
