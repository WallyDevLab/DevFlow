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
let owner: TestUser, scrum: TestUser, po: TestUser, dev: TestUser;
let ws: string;

beforeAll(async () => {
  ctx = await createApp();
  [owner, scrum, po, dev] = await Promise.all(
    ['Owner', 'Scrum', 'Po', 'Dev'].map((n) => signup(ctx.api, n)),
  );
  ws = await workspaceWith(ctx.api, owner, [
    [scrum, 'SCRUM_MASTER'],
    [po, 'PRODUCT_OWNER'],
    [dev, 'DEVELOPER'],
  ]);
});
afterAll(async () => {
  await ctx.app.close();
});

let n = 0;
async function fresh() {
  const project = await projectIn(ctx.api, owner, ws, `SP${n++}`);
  const done = await statusId(ctx.api, owner, project, 'Done');
  const task = (title: string, points: number) =>
    taskIn(ctx.api, dev, project, { title, storyPoints: points });
  const sprint = async (
    name = 'Sprint',
    start = '2026-03-02',
    end = '2026-03-16',
  ) =>
    (
      await ctx.api(scrum.token).post(`/projects/${project}/sprints`, {
        name,
        startDate: start,
        endDate: end,
      })
    ).body.id as string;
  const plan = (taskId: string, sprintId: string | null) =>
    ctx.api(po.token).patch(`/tasks/${taskId}`, { sprintId });
  const finish = (taskId: string) =>
    ctx.api(dev.token).patch(`/tasks/${taskId}`, { statusId: done });
  const report = async (sprintId: string) =>
    (await ctx.api(owner.token).get(`/sprints/${sprintId}/report`)).body;
  const backlog = async () =>
    (await ctx.api(dev.token).get(`/projects/${project}/backlog`)).body;
  return { project, done, task, sprint, plan, finish, report, backlog };
}

describe('creating sprints', () => {
  it('requires the start date to be before the end date', async () => {
    const { project } = await fresh();
    const create = (startDate: string, endDate: string) =>
      ctx.api(scrum.token).post(`/projects/${project}/sprints`, {
        name: 'S',
        startDate,
        endDate,
      });
    expect((await create('2026-03-16', '2026-03-02')).status).toBe(400);
    expect((await create('2026-03-02', '2026-03-02')).status).toBe(400);
    expect((await create('not-a-date', '2026-03-02')).status).toBe(400);
    expect((await create('2026-03-02', '2026-03-16')).status).toBe(201);
  });

  it('validates the name', async () => {
    const { project } = await fresh();
    expect(
      (
        await ctx.api(scrum.token).post(`/projects/${project}/sprints`, {
          name: ' ',
          startDate: '2026-03-02',
          endDate: '2026-03-16',
        })
      ).status,
    ).toBe(400);
  });
});

describe('the backlog', () => {
  it('lists unscheduled, unfinished work and keeps it out of finished-task noise', async () => {
    const f = await fresh();
    const a = await f.task('A', 1),
      b = await f.task('B', 1),
      c = await f.task('C', 1);
    await f.finish(c.id);
    const bl = await f.backlog();
    expect(bl.backlog.map((t: { key: string }) => t.key)).toEqual([
      a.key,
      b.key,
    ]);
  });

  it('orders by rank and persists reordering', async () => {
    const f = await fresh();
    const a = await f.task('A', 1),
      b = await f.task('B', 1),
      c = await f.task('C', 1);
    await ctx.api(po.token).patch(`/tasks/${c.id}`, { backlogRank: 1 });
    expect(
      (await f.backlog()).backlog.map((t: { key: string }) => t.key),
    ).toEqual([c.key, a.key, b.key]);
  });

  it('moves tasks between the backlog and sprints', async () => {
    const f = await fresh();
    const t = await f.task('A', 2);
    const s = await f.sprint();
    await f.plan(t.id, s);
    let bl = await f.backlog();
    expect(bl.backlog).toHaveLength(0);
    expect(bl.sprints[0].tasks.map((x: { key: string }) => x.key)).toEqual([
      t.key,
    ]);
    expect(bl.sprints[0].points).toBe(2);
    await f.plan(t.id, null);
    bl = await f.backlog();
    expect(bl.backlog).toHaveLength(1);
  });

  it('tells each user what they may do', async () => {
    const f = await fresh();
    expect(
      (await ctx.api(dev.token).get(`/projects/${f.project}/backlog`)).body
        .permissions,
    ).toEqual({ planBacklog: false, manageSprints: false });
    expect(
      (await ctx.api(po.token).get(`/projects/${f.project}/backlog`)).body
        .permissions,
    ).toEqual({ planBacklog: true, manageSprints: false });
    expect(
      (await ctx.api(scrum.token).get(`/projects/${f.project}/backlog`)).body
        .permissions,
    ).toEqual({ planBacklog: true, manageSprints: true });
  });

  it('rejects a task being planned into another project’s sprint', async () => {
    const f = await fresh(),
      g = await fresh();
    const t = await f.task('A', 1);
    expect((await f.plan(t.id, await g.sprint())).status).toBe(400);
  });
});

describe('starting sprints', () => {
  it('allows only one active sprint per project', async () => {
    const f = await fresh();
    const s1 = await f.sprint('One'),
      s2 = await f.sprint('Two');
    expect(
      (await ctx.api(scrum.token).post(`/sprints/${s1}/start`)).status,
    ).toBe(204);
    const second = await ctx.api(scrum.token).post(`/sprints/${s2}/start`);
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/One/);
  });

  it('holds the one-active-sprint rule under concurrency (database-enforced)', async () => {
    const f = await fresh();
    const [s1, s2, s3] = [
      await f.sprint('A'),
      await f.sprint('B'),
      await f.sprint('C'),
    ];
    const results = await Promise.all(
      [s1, s2, s3].map((s) => ctx.api(scrum.token).post(`/sprints/${s}/start`)),
    );
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
    expect(
      await ctx.prisma.sprint.count({
        where: { projectId: f.project, status: 'ACTIVE' },
      }),
    ).toBe(1);
  });

  it('can’t start a sprint twice, or edit it once completed', async () => {
    const f = await fresh();
    const s = await f.sprint();
    await ctx.api(scrum.token).post(`/sprints/${s}/start`);
    expect(
      (await ctx.api(scrum.token).post(`/sprints/${s}/start`)).status,
    ).toBe(400);
    await ctx
      .api(scrum.token)
      .post(`/sprints/${s}/complete`, { incompleteTo: 'BACKLOG' });
    expect(
      (await ctx.api(scrum.token).post(`/sprints/${s}/start`)).status,
    ).toBe(400); // can't reopen
    expect(
      (await ctx.api(scrum.token).patch(`/sprints/${s}`, { name: 'x' })).status,
    ).toBe(400);
  });
});

describe('completing sprints', () => {
  it('sends unfinished work to the backlog, or to another planned sprint, on explicit request', async () => {
    const f = await fresh();
    const done = await f.task('Done one', 3),
      open = await f.task('Open one', 5);
    const s1 = await f.sprint('One'),
      s2 = await f.sprint('Two');
    await f.plan(done.id, s1);
    await f.plan(open.id, s1);
    await ctx.api(scrum.token).post(`/sprints/${s1}/start`);
    await f.finish(done.id);
    await ctx
      .api(scrum.token)
      .post(`/sprints/${s1}/complete`, { incompleteTo: s2 });
    const bl = await f.backlog();
    expect(
      bl.sprints
        .find((s: { id: string }) => s.id === s2)
        .tasks.map((t: { key: string }) => t.key),
    ).toEqual([open.key]);
  });

  it('requires an explicit, valid destination for unfinished work', async () => {
    const f = await fresh();
    const s = await f.sprint();
    await ctx.api(scrum.token).post(`/sprints/${s}/start`);
    const other = await fresh();
    for (const incompleteTo of [
      'nonsense',
      '00000000-0000-4000-8000-000000000000',
      await other.sprint(),
    ]) {
      expect(
        (
          await ctx
            .api(scrum.token)
            .post(`/sprints/${s}/complete`, { incompleteTo })
        ).status,
      ).toBe(400);
    }
    expect(
      (await ctx.api(scrum.token).post(`/sprints/${s}/complete`, {})).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api(scrum.token)
          .post(`/sprints/${s}/complete`, { incompleteTo: 'BACKLOG' })
      ).status,
    ).toBe(204);
    expect(
      (
        await ctx
          .api(scrum.token)
          .post(`/sprints/${s}/complete`, { incompleteTo: 'BACKLOG' })
      ).status,
    ).toBe(400); // already completed
  });

  it('can’t complete a sprint that hasn’t started', async () => {
    const f = await fresh();
    expect(
      (
        await ctx
          .api(scrum.token)
          .post(`/sprints/${await f.sprint()}/complete`, {
            incompleteTo: 'BACKLOG',
          })
      ).status,
    ).toBe(400);
  });

  it('refuses to add or remove work in a completed sprint', async () => {
    const f = await fresh();
    const t = await f.task('A', 1),
      s = await f.sprint();
    await ctx.api(scrum.token).post(`/sprints/${s}/start`);
    await ctx
      .api(scrum.token)
      .post(`/sprints/${s}/complete`, { incompleteTo: 'BACKLOG' });
    expect((await f.plan(t.id, s)).status).toBe(400);
  });
});

describe('the sprint report', () => {
  it('preserves the original commitment when scope changes mid-sprint', async () => {
    const f = await fresh();
    const a = await f.task('A', 3),
      b = await f.task('B', 5),
      c = await f.task('C', 2),
      d = await f.task('D', 1);
    const s = await f.sprint();
    await f.plan(a.id, s);
    await f.plan(b.id, s);
    await f.plan(d.id, s);
    await ctx.api(scrum.token).post(`/sprints/${s}/start`);
    await f.plan(c.id, s); // added after the start
    await f.plan(d.id, null); // removed after the start
    await f.finish(a.id);
    await f.finish(c.id);
    await ctx
      .api(scrum.token)
      .post(`/sprints/${s}/complete`, { incompleteTo: 'BACKLOG' });

    const r = await f.report(s);
    expect(r.final).toBe(true);
    expect(r.committed.map((x: { key: string }) => x.key).sort()).toEqual(
      [a.key, b.key, d.key].sort(),
    );
    expect(r.committedPoints).toBe(9);
    expect(r.addedPoints).toBe(2);
    expect(r.removedPoints).toBe(1);
    expect(r.completed.map((x: { key: string }) => x.key).sort()).toEqual(
      [a.key, c.key].sort(),
    );
    // Completion rate = completed *committed* points / committed points: 3 / 9.
    expect(r.completedCommittedPoints).toBe(3);
    expect(r.completionRate).toBe(33);
    expect(r.incomplete.map((x: { key: string }) => x.key)).toEqual([b.key]);
  });

  it('doesn’t change when tasks are edited or deleted after the sprint', async () => {
    const f = await fresh();
    const a = await f.task('A', 3),
      b = await f.task('B', 5);
    const s = await f.sprint();
    await f.plan(a.id, s);
    await f.plan(b.id, s);
    await ctx.api(scrum.token).post(`/sprints/${s}/start`);
    await f.finish(a.id);
    await ctx
      .api(scrum.token)
      .post(`/sprints/${s}/complete`, { incompleteTo: 'BACKLOG' });
    const before = await f.report(s);

    await ctx
      .api(owner.token)
      .patch(`/tasks/${a.id}`, { storyPoints: 99, title: 'Rewritten' });
    await ctx.api(owner.token).delete(`/tasks/${b.id}`);
    const after = await f.report(s);
    expect(after.committedPoints).toBe(before.committedPoints);
    expect(after.completionRate).toBe(before.completionRate);
    expect(after.committed.map((x: { title: string }) => x.title)).toEqual(
      before.committed.map((x: { title: string }) => x.title),
    );
    expect(
      after.committed.find((x: { key: string }) => x.key === b.key).title,
    ).toBe('B'); // survives deletion
  });

  it('has no completion rate when nothing was committed', async () => {
    const f = await fresh();
    const s = await f.sprint();
    await ctx.api(scrum.token).post(`/sprints/${s}/start`);
    await ctx
      .api(scrum.token)
      .post(`/sprints/${s}/complete`, { incompleteTo: 'BACKLOG' });
    expect((await f.report(s)).completionRate).toBeNull();
  });

  it('gives a live view while the sprint is running', async () => {
    const f = await fresh();
    const a = await f.task('A', 4);
    const s = await f.sprint();
    await f.plan(a.id, s);
    await ctx.api(scrum.token).post(`/sprints/${s}/start`);
    await f.finish(a.id);
    const live = await f.report(s);
    expect(live).toMatchObject({
      final: false,
      committedPoints: 4,
      completedCommittedPoints: 4,
      completionRate: 100,
    });
  });

  it('records the original commitment from the start, not from when the report is read', async () => {
    const f = await fresh();
    const a = await f.task('A', 2);
    const s = await f.sprint();
    await f.plan(a.id, s);
    await ctx.api(scrum.token).post(`/sprints/${s}/start`);
    await ctx.api(owner.token).patch(`/tasks/${a.id}`, { storyPoints: 8 });
    expect((await f.report(s)).committedPoints).toBe(2);
  });
});
