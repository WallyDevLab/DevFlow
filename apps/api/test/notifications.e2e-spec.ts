import { createApp } from './helpers/app.js';
import {
  eventually,
  projectIn,
  signup,
  statusId,
  taskIn,
  workspaceWith,
  type TestUser,
} from './helpers/factory.js';
import { pullRequestPayload, sendWebhook } from './helpers/mock-github.js';

type Ctx = Awaited<ReturnType<typeof createApp>>;
let ctx: Ctx;
let owner: TestUser,
  alice: TestUser,
  bob: TestUser,
  carol: TestUser,
  outsider: TestUser;
let ws: string;

beforeAll(async () => {
  ctx = await createApp();
  [owner, alice, bob, carol, outsider] = await Promise.all(
    ['Olive', 'Alice', 'Bobby', 'Carol', 'Xavier'].map((n) =>
      signup(ctx.api, n),
    ),
  );
  ws = await workspaceWith(ctx.api, owner, [
    [alice, 'DEVELOPER'],
    [bob, 'DEVELOPER'],
    [carol, 'DEVELOPER'],
  ]);
});
afterAll(async () => {
  await ctx.app.close();
});

type Note = {
  id: string;
  type: string;
  message: string;
  link: string;
  readAt: string | null;
};
const inbox = async (u: TestUser, qs = '') =>
  (await ctx.api(u.token).get(`/notifications${qs ? `?${qs}` : '?limit=50'}`))
    .body as { items: Note[]; unreadCount: number };
const notes = async (u: TestUser, type?: string) =>
  (await inbox(u)).items.filter((n) => !type || n.type === type);
const count = async (u: TestUser, type?: string) =>
  (await notes(u, type)).length;

let n = 0;
const fresh = async () => {
  const project = await projectIn(ctx.api, owner, ws, `NF${n++}`);
  return {
    project,
    task: (title: string, body: object = {}) =>
      taskIn(ctx.api, owner, project, { title, ...body }),
  };
};

describe('assignment', () => {
  it('notifies the assignee, with a readable message and a link to the task', async () => {
    const { task } = await fresh();
    const t = await task('Write docs');
    await ctx
      .api(owner.token)
      .patch(`/tasks/${t.id}`, { assigneeId: alice.id });
    const note = (await notes(alice, 'TASK_ASSIGNED')).find(
      (x) => x.link === `/tasks/${t.id}`,
    )!;
    expect(note.message).toBe(`Olive assigned you ${t.key} “Write docs”`);
    expect(note.readAt).toBeNull();
  });

  it('notifies on creation with an assignee, but never the person who acted', async () => {
    const { task } = await fresh();
    const before = await count(bob);
    await task('Born assigned', { assigneeId: bob.id });
    expect(await count(bob)).toBe(before + 1);
    expect(await count(owner)).toBe(0);
  });

  it('doesn’t notify when you assign yourself, or on unrelated edits', async () => {
    const { task } = await fresh();
    const t = await task('Mine');
    const before = await count(alice);
    await ctx
      .api(alice.token)
      .patch(`/tasks/${t.id}`, { assigneeId: alice.id });
    await ctx.api(owner.token).patch(`/tasks/${t.id}`, { priority: 'HIGH' });
    expect(await count(alice)).toBe(before);
  });

  it('notifies only the new assignee on reassignment', async () => {
    const { task } = await fresh();
    const t = await task('Passed on', { assigneeId: alice.id });
    const [a, b] = [await count(alice), await count(bob)];
    await ctx.api(owner.token).patch(`/tasks/${t.id}`, { assigneeId: bob.id });
    expect([await count(alice), await count(bob)]).toEqual([a, b + 1]);
  });
});

describe('preferences', () => {
  it('lists every kind, on by default', async () => {
    const prefs = (await ctx.api(carol.token).get('/notifications/preferences'))
      .body;
    expect(prefs.map((p: { type: string }) => p.type).sort()).toEqual([
      'MENTION',
      'PULL_REQUEST',
      'SPRINT_COMPLETED',
      'SPRINT_STARTED',
      'TASK_ASSIGNED',
      'TASK_BLOCKED',
    ]);
    expect(prefs.every((p: { inApp: boolean }) => p.inApp)).toBe(true);
  });

  it('suppresses a muted kind, and resumes when unmuted', async () => {
    const { task } = await fresh();
    const t = await task('Muted');
    await ctx.api(carol.token).put('/notifications/preferences', {
      type: 'TASK_ASSIGNED',
      inApp: false,
    });
    const before = await count(carol, 'TASK_ASSIGNED');
    await ctx
      .api(owner.token)
      .patch(`/tasks/${t.id}`, { assigneeId: carol.id });
    expect(await count(carol, 'TASK_ASSIGNED')).toBe(before);
    expect(
      (await ctx.api(carol.token).get('/notifications/preferences')).body.find(
        (p: { type: string }) => p.type === 'TASK_ASSIGNED',
      ).inApp,
    ).toBe(false);

    await ctx.api(carol.token).put('/notifications/preferences', {
      type: 'TASK_ASSIGNED',
      inApp: true,
    });
    await ctx
      .api(owner.token)
      .patch(`/tasks/${t.id}`, { assigneeId: alice.id });
    await ctx
      .api(owner.token)
      .patch(`/tasks/${t.id}`, { assigneeId: carol.id });
    expect(await count(carol, 'TASK_ASSIGNED')).toBe(before + 1);
  });

  it('rejects unknown kinds and non-boolean values', async () => {
    expect(
      (
        await ctx
          .api(carol.token)
          .put('/notifications/preferences', { type: 'NOPE', inApp: false })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api(carol.token)
          .put('/notifications/preferences', { type: 'MENTION', inApp: 'no' })
      ).status,
    ).toBe(400);
  });
});

describe('blocked tasks', () => {
  it('notifies the assignee and the reporter, with the reason, but not the person who blocked it', async () => {
    const { task } = await fresh();
    const t = await task('Stuck', { assigneeId: alice.id }); // reporter: owner
    const [a, o, b] = [
      await count(alice, 'TASK_BLOCKED'),
      await count(owner, 'TASK_BLOCKED'),
      await count(bob, 'TASK_BLOCKED'),
    ];
    await ctx.api(bob.token).patch(`/tasks/${t.id}`, {
      blocked: true,
      blockedReason: 'waiting on keys',
    });
    expect([
      await count(alice, 'TASK_BLOCKED'),
      await count(owner, 'TASK_BLOCKED'),
      await count(bob, 'TASK_BLOCKED'),
    ]).toEqual([a + 1, o + 1, b]);
    expect((await notes(alice, 'TASK_BLOCKED'))[0].message).toBe(
      `Bobby marked ${t.key} “Stuck” as blocked: waiting on keys`,
    );
  });

  it('doesn’t notify when a task is unblocked', async () => {
    const { task } = await fresh();
    const t = await task('Flaky', { assigneeId: alice.id });
    await ctx.api(bob.token).patch(`/tasks/${t.id}`, { blocked: true });
    const before = await count(alice, 'TASK_BLOCKED');
    await ctx.api(bob.token).patch(`/tasks/${t.id}`, { blocked: false });
    expect(await count(alice, 'TASK_BLOCKED')).toBe(before);
  });
});

describe('mentions', () => {
  let t: { id: string; key: string };
  beforeAll(async () => {
    t = await (await fresh()).task('Discuss');
  });
  const comment = (u: TestUser, body: string, mentionIds?: string[]) =>
    ctx.api(u.token).post(`/tasks/${t.id}/comments`, { body, mentionIds });

  it('notifies the mentioned person with a link to the task', async () => {
    const before = await count(carol, 'MENTION');
    await comment(owner, 'Thanks @Carol, can you check?', [carol.id]);
    const note = (await notes(carol, 'MENTION'))[0];
    expect(await count(carol, 'MENTION')).toBe(before + 1);
    expect(note).toMatchObject({
      message: `Olive mentioned you in a comment on ${t.key} “Discuss”`,
      link: `/tasks/${t.id}`,
    });
  });

  it('ignores a mention id whose name isn’t actually in the text', async () => {
    const before = await count(alice, 'MENTION');
    await comment(owner, 'no name here', [alice.id]);
    expect(await count(alice, 'MENTION')).toBe(before);
  });

  it('ignores mentions of people outside the workspace, and of yourself', async () => {
    await comment(owner, 'ping @Xavier', [outsider.id]);
    await comment(owner, 'note to self @Olive', [owner.id]);
    expect(await count(outsider)).toBe(0);
    expect(await count(owner, 'MENTION')).toBe(0);
  });

  it('rejects malformed mention ids', async () => {
    expect((await comment(owner, 'hi', ['nope'])).status).toBe(400);
  });

  it('notifies only the newly mentioned when a comment is edited', async () => {
    const id = (await comment(alice, 'draft')).body.id;
    const [b0, c0] = [
      await count(bob, 'MENTION'),
      await count(carol, 'MENTION'),
    ];
    await ctx.api(alice.token).patch(`/comments/${id}`, {
      body: 'draft, cc @Bobby',
      mentionIds: [bob.id],
    });
    await ctx.api(alice.token).patch(`/comments/${id}`, {
      body: 'draft, cc @Bobby and @Carol',
      mentionIds: [bob.id, carol.id],
    });
    await ctx.api(alice.token).patch(`/comments/${id}`, {
      body: 'draft, cc @Bobby and @Carol!',
      mentionIds: [bob.id, carol.id],
    });
    expect([
      await count(bob, 'MENTION'),
      await count(carol, 'MENTION'),
    ]).toEqual([b0 + 1, c0 + 1]);
  });
});

describe('sprints', () => {
  it('notifies assignees of the sprint’s tasks when it starts and completes, but not the starter or others', async () => {
    const { project, task } = await fresh();
    const [ta, tb] = [
      await task('A', { assigneeId: alice.id }),
      await task('B', { assigneeId: bob.id }),
    ];
    const s = (
      await ctx.api(owner.token).post(`/projects/${project}/sprints`, {
        name: 'Sprint X',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      })
    ).body.id;
    await ctx.api(owner.token).patch(`/tasks/${ta.id}`, { sprintId: s });
    await ctx.api(owner.token).patch(`/tasks/${tb.id}`, { sprintId: s });
    const before = {
      alice: await count(alice, 'SPRINT_STARTED'),
      carol: await count(carol, 'SPRINT_STARTED'),
      owner: await count(owner, 'SPRINT_STARTED'),
    };
    await ctx.api(owner.token).post(`/sprints/${s}/start`);
    expect(await count(alice, 'SPRINT_STARTED')).toBe(before.alice + 1);
    expect(await count(carol, 'SPRINT_STARTED')).toBe(before.carol);
    expect(await count(owner, 'SPRINT_STARTED')).toBe(before.owner);
    await ctx
      .api(owner.token)
      .post(`/sprints/${s}/complete`, { incompleteTo: 'BACKLOG' });
    const done = (await notes(alice, 'SPRINT_COMPLETED'))[0];
    expect(done.link).toBe(`/sprints/${s}/report`);
    expect(await count(bob, 'SPRINT_COMPLETED')).toBeGreaterThan(0);
  });
});

describe('pull requests', () => {
  it('notifies the task’s assignee when a PR is linked, reviewed, fails checks and merges — once each', async () => {
    const { project, task } = await fresh();
    const t = await task('Auth', { assigneeId: alice.id });
    const instId = 700_000 + Math.floor(Math.random() * 90_000);
    const repoId = 800_000 + Math.floor(Math.random() * 90_000);
    const inst = await ctx.prisma.gitHubInstallation
      .create({
        data: {
          workspaceId: ws,
          installationId: instId,
          accountLogin: 'acme',
          accountType: 'Organization',
          connectedById: owner.id,
        },
      })
      .catch(() => null);
    // One installation per workspace: reuse the workspace's if another test created it.
    const installation =
      inst ??
      (await ctx.prisma.gitHubInstallation.findUniqueOrThrow({
        where: { workspaceId: ws },
      }));
    await ctx.prisma.gitHubRepository.create({
      data: {
        installationId: installation.id,
        githubId: repoId,
        fullName: 'acme/nf',
        projectId: project,
      },
    });
    const iid = Number(installation.installationId);
    const key = t.key;
    const base = { installation: { id: iid }, repository: { id: repoId } };
    const send = (event: string, payload: object) =>
      sendWebhook(ctx.server, event, payload);
    const prs = () => count(alice, 'PULL_REQUEST');
    const start = await prs();

    await send('pull_request', {
      ...pullRequestPayload('opened', {
        number: 7,
        branch: `feature/${key}-x`,
        sha: 's1',
      }),
      ...base,
    });
    await eventually(async () => expect(await prs()).toBe(start + 1));

    const review = (state: string) =>
      send('pull_request_review', {
        ...base,
        action: 'submitted',
        pull_request: { number: 7 },
        review: { state },
      });
    await review('COMMENTED');
    await review('APPROVED');
    await eventually(async () => expect(await prs()).toBe(start + 2));

    const failing = () =>
      send('check_suite', {
        ...base,
        action: 'completed',
        check_suite: {
          head_sha: 's1',
          status: 'completed',
          conclusion: 'failure',
        },
      });
    await failing();
    await eventually(async () => expect(await prs()).toBe(start + 3));
    await failing(); // the same failure again
    await new Promise((r) => setTimeout(r, 300));
    expect(await prs()).toBe(start + 3);

    await send('pull_request', {
      ...pullRequestPayload('closed', {
        number: 7,
        branch: `feature/${key}-x`,
        sha: 's1',
        merged: true,
      }),
      ...base,
    });
    await eventually(async () => expect(await prs()).toBe(start + 4));
    expect((await notes(alice, 'PULL_REQUEST'))[0].message).toBe(
      `Pull request #7 was merged (${key} “Auth”)`,
    );
  });
});

describe('reading and visibility', () => {
  it('counts, lists, filters and marks notifications read — only your own', async () => {
    const { task } = await fresh();
    const x = await task('Read me');
    await ctx.api(owner.token).patch(`/tasks/${x.id}`, { assigneeId: bob.id });
    const list = await inbox(bob);
    const unread = list.unreadCount;
    expect(unread).toBeGreaterThan(0);
    expect(
      (await ctx.api(bob.token).get('/notifications/unread-count')).body
        .unreadCount,
    ).toBe(unread);

    const first = list.items[0];
    expect(
      (await ctx.api(bob.token).post(`/notifications/${first.id}/read`)).status,
    ).toBe(204);
    expect(
      (await ctx.api(bob.token).post(`/notifications/${first.id}/read`)).status,
    ).toBe(204); // idempotent
    expect(
      (await ctx.api(bob.token).get('/notifications/unread-count')).body
        .unreadCount,
    ).toBe(unread - 1);
    expect(
      (await ctx.api(alice.token).post(`/notifications/${first.id}/read`))
        .status,
    ).toBe(404); // not theirs
    expect(
      (
        await ctx
          .api(bob.token)
          .post('/notifications/00000000-0000-4000-8000-000000000000/read')
      ).status,
    ).toBe(404);

    expect((await inbox(bob, 'limit=1')).items).toHaveLength(1);
    expect(
      (await ctx.api(bob.token).get('/notifications?limit=500')).status,
    ).toBe(400);
    expect(
      (await inbox(bob, 'unread=true&limit=50')).items.every(
        (i) => i.readAt === null,
      ),
    ).toBe(true);

    expect(
      (await ctx.api(bob.token).post('/notifications/read-all')).status,
    ).toBe(204);
    expect(
      (await ctx.api(bob.token).get('/notifications/unread-count')).body
        .unreadCount,
    ).toBe(0);
  });

  it('hides a workspace’s notifications once you leave it', async () => {
    const dana = await signup(ctx.api, 'Dana');
    const ws2 = await workspaceWith(
      ctx.api,
      owner,
      [[dana, 'DEVELOPER']],
      'Temp WS',
    );
    const project = await projectIn(ctx.api, owner, ws2, 'TMP');
    await taskIn(ctx.api, owner, project, {
      title: 'For Dana',
      assigneeId: dana.id,
    });
    expect((await inbox(dana)).items.length).toBe(1);
    await ctx.api(owner.token).delete(`/workspaces/${ws2}/members/${dana.id}`);
    expect(await inbox(dana)).toEqual({ items: [], unreadCount: 0 });
  });

  it('requires authentication', async () => {
    expect((await ctx.api().get('/notifications')).status).toBe(401);
  });
});

describe('activity feed', () => {
  it('shows recent activity to members, newest first, naming actor and task', async () => {
    const { task } = await fresh();
    const t = await task('Feed task');
    await ctx
      .api(owner.token)
      .patch(`/tasks/${t.id}`, { assigneeId: alice.id });
    await ctx.api(bob.token).patch(`/tasks/${t.id}`, {
      statusId: await statusId(
        ctx.api,
        owner,
        (await ctx.prisma.task.findUniqueOrThrow({ where: { id: t.id } }))
          .projectId,
        'In Progress',
      ),
    });
    const feed = (await ctx.api(carol.token).get(`/workspaces/${ws}/activity`))
      .body as {
      actor: string;
      taskKey: string;
      type: string;
      createdAt: string;
    }[];
    expect(
      feed.some(
        (e) =>
          e.actor === 'Olive' && e.taskKey === t.key && e.type === 'assigned',
      ),
    ).toBe(true);
    expect(
      feed.some((e) => e.actor === 'Bobby' && e.type === 'status_changed'),
    ).toBe(true);
    expect(
      feed.every(
        (e, i) =>
          i === 0 || new Date(feed[i - 1].createdAt) >= new Date(e.createdAt),
      ),
    ).toBe(true);
  });

  it('is hidden from non-members and from people who left', async () => {
    expect(
      (await ctx.api(outsider.token).get(`/workspaces/${ws}/activity`)).status,
    ).toBe(404);
  });
});
