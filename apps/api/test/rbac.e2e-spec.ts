import { createHash } from 'node:crypto';
import { createApp } from './helpers/app.js';
import {
  projectIn,
  signup,
  statusId,
  taskIn,
  workspaceWith,
  type TestUser,
} from './helpers/factory.js';

type Ctx = Awaited<ReturnType<typeof createApp>>;
let ctx: Ctx;

let owner: TestUser,
  admin: TestUser,
  scrum: TestUser,
  po: TestUser,
  dev: TestUser,
  viewer: TestUser,
  outsider: TestUser;
let ws: string, project: string, task: { id: string; key: string };
let sprintId: string, labelId: string, commentId: string, doneStatus: string;

beforeAll(async () => {
  ctx = await createApp();
  const { api } = ctx;
  [owner, admin, scrum, po, dev, viewer, outsider] = await Promise.all(
    ['Owner', 'Admin', 'Scrum', 'Po', 'Dev', 'Viewer', 'Outsider'].map((n) =>
      signup(api, n),
    ),
  );
  ws = await workspaceWith(api, owner, [
    [admin, 'ADMIN'],
    [scrum, 'SCRUM_MASTER'],
    [po, 'PRODUCT_OWNER'],
    [dev, 'DEVELOPER'],
    [viewer, 'VIEWER'],
  ]);
  project = await projectIn(api, owner, ws, 'RB');
  task = await taskIn(api, dev, project, { title: 'Seed task' });
  sprintId = (
    await api(owner.token).post(`/projects/${project}/sprints`, {
      name: 'S1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    })
  ).body.id;
  labelId = (
    await api(dev.token).post(`/projects/${project}/labels`, {
      name: 'bug',
      color: '#d95926',
    })
  ).body.id;
  commentId = (
    await api(dev.token).post(`/tasks/${task.id}/comments`, { body: 'hello' })
  ).body.id;
  doneStatus = await statusId(api, owner, project, 'Done');
});
afterAll(async () => {
  await ctx.app.close();
});

describe('workspaces', () => {
  it('makes the creator the owner and lists only workspaces you belong to', async () => {
    const mine = await ctx.api(owner.token).get('/workspaces');
    expect(mine.body).toEqual([
      expect.objectContaining({ id: ws, role: 'OWNER' }),
    ]);
    expect((await ctx.api(outsider.token).get('/workspaces')).body).toEqual([]);
  });

  it('rejects invalid workspace names', async () => {
    expect(
      (await ctx.api(owner.token).post('/workspaces', { name: 'x' })).status,
    ).toBe(400);
  });

  it('lets any member see the member list, with their roles', async () => {
    const res = await ctx.api(viewer.token).get(`/workspaces/${ws}/members`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
    expect(
      res.body.find((m: { name: string }) => m.name === 'Owner').role,
    ).toBe('OWNER');
  });
});

describe('every protected endpoint requires authentication', () => {
  const endpoints = (): [string, string][] => [
    ['get', '/workspaces'],
    ['post', '/workspaces'],
    ['get', `/workspaces/${ws}`],
    ['get', `/workspaces/${ws}/members`],
    ['get', `/workspaces/${ws}/invitations`],
    ['get', `/workspaces/${ws}/activity`],
    ['get', `/workspaces/${ws}/integrations/github`],
    ['get', `/workspaces/${ws}/projects`],
    ['get', `/projects/${project}`],
    ['get', `/projects/${project}/boards`],
    ['get', `/projects/${project}/backlog`],
    ['get', `/projects/${project}/analytics`],
    ['get', `/projects/${project}/labels`],
    ['post', `/projects/${project}/tasks`],
    ['get', `/tasks/${task.id}`],
    ['patch', `/tasks/${task.id}`],
    ['delete', `/tasks/${task.id}`],
    ['get', `/tasks/${task.id}/comments`],
    ['get', `/sprints/${sprintId}/report`],
    ['post', `/sprints/${sprintId}/start`],
    ['post', `/projects/${project}/statuses`],
    ['get', '/notifications'],
    ['get', '/notifications/unread-count'],
    ['get', '/notifications/preferences'],
    ['get', '/auth/me'],
  ];

  it('returns 401 without a token', async () => {
    for (const [method, url] of endpoints()) {
      const res = await (
        ctx.api() as Record<string, (u: string) => Promise<{ status: number }>>
      )[method](url);
      expect([method, url, res.status]).toEqual([method, url, 401]);
    }
  });
});

describe('tenant isolation: a non-member can’t see or touch anything in the workspace', () => {
  const targets = (): [string, string, object?][] => [
    ['get', `/workspaces/${ws}`],
    ['get', `/workspaces/${ws}/members`],
    ['get', `/workspaces/${ws}/invitations`],
    ['get', `/workspaces/${ws}/activity`],
    ['get', `/workspaces/${ws}/projects`],
    ['post', `/workspaces/${ws}/projects`, { name: 'Hack', key: 'HK' }],
    [
      'post',
      `/workspaces/${ws}/invitations`,
      { email: 'a@b.co', role: 'VIEWER' },
    ],
    ['get', `/projects/${project}`],
    ['get', `/projects/${project}/boards`],
    ['get', `/projects/${project}/backlog`],
    ['get', `/projects/${project}/analytics`],
    ['get', `/projects/${project}/labels`],
    ['post', `/projects/${project}/tasks`, { title: 'x' }],
    [
      'post',
      `/projects/${project}/sprints`,
      { name: 'x', startDate: '2026-01-01', endDate: '2026-01-02' },
    ],
    [
      'post',
      `/projects/${project}/statuses`,
      { name: 'Hack', category: 'TODO' },
    ],
    ['get', `/tasks/${task.id}`],
    ['patch', `/tasks/${task.id}`, { title: 'pwned' }],
    ['delete', `/tasks/${task.id}`],
    ['get', `/tasks/${task.id}/comments`],
    ['post', `/tasks/${task.id}/comments`, { body: 'hi' }],
    ['patch', `/comments/${commentId}`, { body: 'x' }],
    ['delete', `/comments/${commentId}`],
    ['patch', `/labels/${labelId}`, { name: 'x' }],
    ['delete', `/labels/${labelId}`],
    ['get', `/sprints/${sprintId}/report`],
    ['post', `/sprints/${sprintId}/start`],
    ['patch', `/sprints/${sprintId}`, { name: 'x' }],
    ['patch', `/statuses/${doneStatus}`, { name: 'x' }],
    ['delete', `/statuses/${doneStatus}`],
  ];

  it('answers 404 for every resource, revealing nothing', async () => {
    for (const [method, url, body] of targets()) {
      const res = await (
        ctx.api(outsider.token) as Record<
          string,
          (u: string, b?: object) => Promise<{ status: number }>
        >
      )[method](url, body);
      expect([method, url, res.status]).toEqual([method, url, 404]);
    }
  });

  it('does not leak a member’s data through another workspace', async () => {
    const other = await workspaceWith(ctx.api, outsider, [], 'Outsider Space');
    const otherProject = await projectIn(ctx.api, outsider, other, 'OS');
    // The outsider owns a different workspace but still can't reach this one.
    expect(
      (await ctx.api(outsider.token).get(`/projects/${project}`)).status,
    ).toBe(404);
    expect(
      (await ctx.api(owner.token).get(`/projects/${otherProject}`)).status,
    ).toBe(404);
  });
});

describe('role-based permissions', () => {
  const as = (u: TestUser) => ctx.api(u.token);

  it('only owners and admins can create projects', async () => {
    expect(
      (
        await as(dev).post(`/workspaces/${ws}/projects`, {
          name: 'Nope',
          key: 'NO',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(viewer).post(`/workspaces/${ws}/projects`, {
          name: 'Nope',
          key: 'NO',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(po).post(`/workspaces/${ws}/projects`, {
          name: 'Nope',
          key: 'NO',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(admin).post(`/workspaces/${ws}/projects`, {
          name: 'Admin Project',
          key: 'AD',
        })
      ).status,
    ).toBe(201);
  });

  it('only owners and admins can edit or archive a project', async () => {
    expect(
      (await as(dev).patch(`/projects/${project}`, { name: 'Renamed' })).status,
    ).toBe(403);
    expect(
      (await as(scrum).patch(`/projects/${project}`, { status: 'ARCHIVED' }))
        .status,
    ).toBe(403);
  });

  it('developers can’t perform administrative operations', async () => {
    expect(
      (
        await as(dev).post(`/workspaces/${ws}/invitations`, {
          email: 'x@y.co',
          role: 'VIEWER',
        })
      ).status,
    ).toBe(403);
    expect((await as(dev).get(`/workspaces/${ws}/invitations`)).status).toBe(
      403,
    );
    expect(
      (
        await as(dev).patch(`/workspaces/${ws}/members/${viewer.id}`, {
          role: 'DEVELOPER',
        })
      ).status,
    ).toBe(403);
    expect(
      (await as(dev).delete(`/workspaces/${ws}/members/${viewer.id}`)).status,
    ).toBe(403);
    expect(
      (
        await as(dev).put(`/projects/${project}/repository`, {
          fullName: 'a/b',
        })
      ).status,
    ).toBe(403);
    expect(
      (await as(dev).delete(`/workspaces/${ws}/integrations/github`)).status,
    ).toBe(403);
    expect(
      (
        await as(dev).post(`/projects/${project}/statuses`, {
          name: 'Hack',
          category: 'TODO',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await as(dev).post(`/projects/${project}/sprints`, {
          name: 'S',
          startDate: '2026-02-01',
          endDate: '2026-02-02',
        })
      ).status,
    ).toBe(403);
  });

  it('viewers are strictly read-only', async () => {
    expect((await as(viewer).get(`/tasks/${task.id}`)).status).toBe(200);
    expect((await as(viewer).get(`/projects/${project}/boards`)).status).toBe(
      200,
    );
    expect(
      (await as(viewer).post(`/projects/${project}/tasks`, { title: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (await as(viewer).patch(`/tasks/${task.id}`, { title: 'x' })).status,
    ).toBe(403);
    expect(
      (await as(viewer).post(`/tasks/${task.id}/comments`, { body: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (
        await as(viewer).post(`/projects/${project}/labels`, {
          name: 'x',
          color: '#000000',
        })
      ).status,
    ).toBe(403);
    expect((await as(viewer).delete(`/tasks/${task.id}`)).status).toBe(403);
  });

  it('only planners (owner, admin, scrum master, product owner) can change sprint scope', async () => {
    expect(
      (await as(dev).patch(`/tasks/${task.id}`, { sprintId })).status,
    ).toBe(403);
    expect((await as(po).patch(`/tasks/${task.id}`, { sprintId })).status).toBe(
      204,
    );
    await as(po).patch(`/tasks/${task.id}`, { sprintId: null });
  });

  it('only owners, admins and scrum masters can start or complete sprints', async () => {
    expect((await as(po).post(`/sprints/${sprintId}/start`)).status).toBe(403);
    expect((await as(dev).post(`/sprints/${sprintId}/start`)).status).toBe(403);
  });

  it('only the author can edit a comment; moderators can delete', async () => {
    expect(
      (await as(po).patch(`/comments/${commentId}`, { body: 'rewritten' }))
        .status,
    ).toBe(403);
    expect(
      (await as(owner).patch(`/comments/${commentId}`, { body: 'rewritten' }))
        .status,
    ).toBe(403);
    expect(
      (
        await as(dev).patch(`/comments/${commentId}`, {
          body: 'edited by author',
        })
      ).status,
    ).toBe(204);
    expect((await as(viewer).delete(`/comments/${commentId}`)).status).toBe(
      403,
    );
  });

  it('only people who plan can rename or delete labels', async () => {
    expect(
      (await as(dev).patch(`/labels/${labelId}`, { name: 'defect' })).status,
    ).toBe(403);
    expect(
      (await as(po).patch(`/labels/${labelId}`, { name: 'defect' })).status,
    ).toBe(200);
  });

  it('developers can delete only tasks they created', async () => {
    const mine = await taskIn(ctx.api, dev, project, { title: 'mine' });
    const theirs = await taskIn(ctx.api, owner, project, { title: 'theirs' });
    expect((await as(dev).delete(`/tasks/${theirs.id}`)).status).toBe(403);
    expect((await as(dev).delete(`/tasks/${mine.id}`)).status).toBe(204);
  });
});

describe('invitations', () => {
  const invite = (u: TestUser, email: string, role = 'DEVELOPER') =>
    ctx.api(u.token).post(`/workspaces/${ws}/invitations`, { email, role });

  it('can’t invite someone as OWNER', async () => {
    expect((await invite(owner, 'new@example.com', 'OWNER')).status).toBe(400);
  });

  it('lets only the owner invite admins', async () => {
    expect((await invite(admin, 'a1@example.com', 'ADMIN')).status).toBe(403);
    expect((await invite(owner, 'a2@example.com', 'ADMIN')).status).toBe(201);
    expect((await invite(admin, 'a3@example.com', 'DEVELOPER')).status).toBe(
      201,
    );
  });

  it('rejects inviting someone who already belongs', async () => {
    expect((await invite(owner, dev.email)).status).toBe(409);
  });

  it('lets only the invited email accept, exactly once', async () => {
    const newcomer = await signup(ctx.api, 'Newcomer');
    const inv = await invite(owner, newcomer.email, 'VIEWER');
    const stranger = await signup(ctx.api, 'Stranger');
    expect(
      (
        await ctx
          .api(stranger.token)
          .post('/invitations/accept', { token: inv.body.token })
      ).status,
    ).toBe(400);
    const ok = await ctx
      .api(newcomer.token)
      .post('/invitations/accept', { token: inv.body.token });
    expect(ok.status).toBe(200);
    expect(ok.body.workspaceId).toBe(ws);
    expect(
      (
        await ctx
          .api(newcomer.token)
          .post('/invitations/accept', { token: inv.body.token })
      ).status,
    ).toBe(400);
    expect(
      (await ctx.api(newcomer.token).get(`/workspaces/${ws}`)).body.role,
    ).toBe('VIEWER');
  });

  it('rejects expired, revoked and unknown tokens with the same generic error', async () => {
    const a = await signup(ctx.api, 'Late');
    const inv = await invite(owner, a.email);
    await ctx.prisma.invitation.updateMany({
      where: { id: inv.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await ctx
      .api(a.token)
      .post('/invitations/accept', { token: inv.body.token });
    const unknown = await ctx
      .api(a.token)
      .post('/invitations/accept', { token: 'nonsense' });
    expect([expired.status, unknown.status]).toEqual([400, 400]);
    expect(expired.body.message).toBe(unknown.body.message);

    const b = await signup(ctx.api, 'Revoked');
    const inv2 = await invite(owner, b.email);
    expect(
      (
        await ctx
          .api(owner.token)
          .delete(`/workspaces/${ws}/invitations/${inv2.body.id}`)
      ).status,
    ).toBe(204);
    expect(
      (
        await ctx
          .api(b.token)
          .post('/invitations/accept', { token: inv2.body.token })
      ).status,
    ).toBe(400);
  });

  it('stores only a hash of the token, and a new invite replaces the old one', async () => {
    const email = `dupe-${Date.now()}@example.com`;
    const first = await invite(owner, email);
    const second = await invite(owner, email);
    expect(
      await ctx.prisma.invitation.count({ where: { token: first.body.token } }),
    ).toBe(0);
    expect(
      await ctx.prisma.invitation.count({
        where: {
          token: createHash('sha256').update(second.body.token).digest('hex'),
        },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.invitation.count({
        where: { workspaceId: ws, email, acceptedAt: null },
      }),
    ).toBe(1);
  });

  it('emails the invitation link', async () => {
    const email = `mailed-${Date.now()}@example.com`;
    const res = await invite(owner, email);
    expect(res.body.emailed).toBe(false); // the test mailbox doesn't deliver
    expect(ctx.mailbox.to(email)[0].text).toContain(
      `/invite?token=${res.body.token}`,
    );
  });
});

describe('membership management', () => {
  it('lets only the owner change roles, never the owner’s own', async () => {
    const m = await signup(ctx.api, 'Member');
    await workspaceWith(ctx.api, owner, [], 'scratch'); // unrelated workspace
    const inv = await ctx
      .api(owner.token)
      .post(`/workspaces/${ws}/invitations`, {
        email: m.email,
        role: 'DEVELOPER',
      });
    await ctx
      .api(m.token)
      .post('/invitations/accept', { token: inv.body.token });

    expect(
      (
        await ctx
          .api(admin.token)
          .patch(`/workspaces/${ws}/members/${m.id}`, { role: 'VIEWER' })
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx
          .api(owner.token)
          .patch(`/workspaces/${ws}/members/${m.id}`, { role: 'OWNER' })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api(owner.token)
          .patch(`/workspaces/${ws}/members/${m.id}`, { role: 'SCRUM_MASTER' })
      ).status,
    ).toBe(204);
    expect(
      (
        await ctx
          .api(owner.token)
          .patch(`/workspaces/${ws}/members/${owner.id}`, { role: 'VIEWER' })
      ).status,
    ).toBe(400);
  });

  it('enforces who can remove whom, and keeps the owner', async () => {
    const a = await signup(ctx.api, 'Victim');
    const inv = await ctx
      .api(owner.token)
      .post(`/workspaces/${ws}/invitations`, {
        email: a.email,
        role: 'DEVELOPER',
      });
    await ctx
      .api(a.token)
      .post('/invitations/accept', { token: inv.body.token });

    expect(
      (
        await ctx
          .api(owner.token)
          .delete(`/workspaces/${ws}/members/${owner.id}`)
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api(admin.token)
          .delete(`/workspaces/${ws}/members/${owner.id}`)
      ).status,
    ).toBe(400);
    expect(
      (await ctx.api(dev.token).delete(`/workspaces/${ws}/members/${a.id}`))
        .status,
    ).toBe(403);
    expect(
      (await ctx.api(admin.token).delete(`/workspaces/${ws}/members/${a.id}`))
        .status,
    ).toBe(204);
    // Removal takes effect immediately.
    expect((await ctx.api(a.token).get(`/workspaces/${ws}`)).status).toBe(404);
    expect((await ctx.api(a.token).get(`/projects/${project}`)).status).toBe(
      404,
    );
  });

  it('lets a member leave', async () => {
    const leaver = await signup(ctx.api, 'Leaver');
    const inv = await ctx
      .api(owner.token)
      .post(`/workspaces/${ws}/invitations`, {
        email: leaver.email,
        role: 'DEVELOPER',
      });
    await ctx
      .api(leaver.token)
      .post('/invitations/accept', { token: inv.body.token });
    expect(
      (
        await ctx
          .api(leaver.token)
          .delete(`/workspaces/${ws}/members/${leaver.id}`)
      ).status,
    ).toBe(204);
  });

  it('records administrative actions in the audit log', async () => {
    const actions = (
      await ctx.prisma.auditLog.findMany({ where: { workspaceId: ws } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'workspace.created',
        'member.invited',
        'member.role_changed',
        'member.removed',
      ]),
    );
  });
});
