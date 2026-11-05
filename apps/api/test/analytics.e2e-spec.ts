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
let owner: TestUser, dev: TestUser, viewer: TestUser, outsider: TestUser;
let ws: string;

const DAY = 86_400_000;
const now = Date.now();
const at = (daysFromNow: number) => new Date(now + daysFromNow * DAY);
const dateOnly = (daysFromNow: number) =>
  at(daysFromNow).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await createApp();
  [owner, dev, viewer, outsider] = await Promise.all(
    ['Owner', 'Dev', 'Viewer', 'Outsider'].map((n) => signup(ctx.api, n)),
  );
  ws = await workspaceWith(ctx.api, owner, [
    [dev, 'DEVELOPER'],
    [viewer, 'VIEWER'],
  ]);
});
afterAll(async () => {
  await ctx.app.close();
});

/** Moves a task through the given status names, then rewrites its history to the given day offsets. */
async function backdate(
  project: string,
  taskId: string,
  plan: {
    created: number;
    moves: { to: string; day: number }[];
    blocked?: { from: number; to?: number };
  },
) {
  for (const m of plan.moves) {
    await ctx.api(owner.token).patch(`/tasks/${taskId}`, {
      statusId: await statusId(ctx.api, owner, project, m.to),
    });
  }
  if (plan.blocked) {
    await ctx
      .api(owner.token)
      .patch(`/tasks/${taskId}`, { blocked: true, blockedReason: 'because' });
    if (plan.blocked.to !== undefined)
      await ctx.api(owner.token).patch(`/tasks/${taskId}`, { blocked: false });
  }
  const events = await ctx.prisma.taskActivity.findMany({
    where: { taskId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const set = (id: string, day: number) =>
    ctx.prisma.taskActivity.update({
      where: { id },
      data: { createdAt: at(day) },
    });
  await set(events.find((e) => e.type === 'created')!.id, plan.created);
  const moves = events.filter((e) => e.type === 'status_changed');
  await Promise.all(moves.map((e, i) => set(e.id, plan.moves[i].day)));
  if (plan.blocked) {
    await set(events.find((e) => e.type === 'blocked')!.id, plan.blocked.from);
    const unblock = events.find((e) => e.type === 'unblocked');
    if (unblock) await set(unblock.id, plan.blocked.to!);
  }
  await ctx.prisma.task.update({
    where: { id: taskId },
    data: { createdAt: at(plan.created) },
  });
}

const get = (project: string, qs = '', u = owner) =>
  ctx.api(u.token).get(`/projects/${project}/analytics${qs}`);
const range = (from: number, to = 0) =>
  `?from=${dateOnly(from)}&to=${dateOnly(to)}`;

describe('delivery metrics from recorded history', () => {
  let project: string;

  beforeAll(async () => {
    project = await projectIn(ctx.api, owner, ws, 'AN');
    // Five delivered tasks with cycle times of 2, 3, 4, 5 and 10 days: started on
    // day T, in review 40% of the way through, done on day T + cycle.
    const cycles = [2, 3, 4, 5, 10];
    for (let i = 0; i < 5; i++) {
      const t = await taskIn(ctx.api, dev, project, {
        title: `Task ${i + 1}`,
        storyPoints: [3, 5, 2, 1, 2][i],
      });
      const start = -30 + 3 * (i + 1);
      await backdate(project, t.id, {
        created: start - 2,
        moves: [
          { to: 'In Progress', day: start },
          { to: 'In Review', day: start + cycles[i] * 0.4 },
          { to: 'Done', day: start + cycles[i] },
        ],
        blocked: i === 0 ? { from: start + 0.5, to: start + 1.5 } : undefined,
      });
    }
    // One task still in progress and blocked since 3 days ago.
    const stuck = await taskIn(ctx.api, dev, project, { title: 'Stuck' });
    await backdate(project, stuck.id, {
      created: -6,
      moves: [{ to: 'In Progress', day: -5 }],
      blocked: { from: -3 },
    });
  });

  it('computes cycle time: median, average and p85 over delivered work', async () => {
    const a = (await get(project, range(-60))).body;
    expect(a.cycleTime).toMatchObject({
      n: 5,
      median: 4,
      average: 4.8,
      p85: 7,
      lowSample: false,
    });
  });

  it('computes lead time to Done', async () => {
    const a = (await get(project, range(-60))).body;
    expect(a.leadTime).toMatchObject({ n: 5, median: 6, definition: 'done' });
  });

  it('shows where completed work spent its time', async () => {
    const { timeInStage } = (await get(project, range(-60))).body.cycleTime;
    expect(timeInStage.inProgressDays).toBeCloseTo(1.9, 1);
    expect(timeInStage.inReviewDays).toBeCloseTo(2.9, 1);
  });

  it('counts current WIP and the work in each stage', async () => {
    const { wip } = (await get(project, range(-60))).body;
    expect(wip.total).toBe(1);
    expect(wip.blockedNow).toBe(1);
    expect(
      wip.byStatus.find((s: { name: string }) => s.name === 'Done').count,
    ).toBe(5);
  });

  it('reports blocked work: current blockers with duration and reason, and total blocked time', async () => {
    const { blocked } = (await get(project, range(-60))).body;
    expect(blocked.current).toHaveLength(1);
    expect(blocked.current[0]).toMatchObject({ reason: 'because' });
    expect(blocked.current[0].days).toBeCloseTo(3, 0);
    expect(blocked.tasks).toBe(2);
    expect(blocked.totalDays).toBeCloseTo(4, 0); // 1 closed + ~3 still open
  });

  it('exposes the events behind the numbers, longest cycle first, with no per-person data', async () => {
    const a = (await get(project, range(-60))).body;
    expect(
      a.completedTasks.map((t: { cycleDays: number }) => t.cycleDays),
    ).toEqual([10, 5, 4, 3, 2]);
    expect(a.completedTasks.at(-1).blockedDays).toBe(1);
    expect(JSON.stringify(a)).not.toMatch(
      /assignee|author|reporter|userId|email/i,
    );
  });

  it('buckets throughput by week', async () => {
    const { weekly } = (await get(project, range(-60))).body;
    expect(
      weekly.reduce(
        (n: number, w: { completed: number }) => n + w.completed,
        0,
      ),
    ).toBe(5);
  });

  it('only counts work delivered inside the chosen range, and flags small samples', async () => {
    const a = (await get(project, range(-14))).body;
    expect(a.cycleTime).toMatchObject({ n: 2, median: 7.5, lowSample: true });
  });

  it('measures lead time to merge only when asked, and only for merged work', async () => {
    const a = (await get(project, `${range(-60)}&definition=merged`)).body;
    expect(a.leadTime).toMatchObject({ n: 0, definition: 'merged' });
    expect(a.cycleTime.n).toBe(5); // cycle time always ends at Done
  });

  it('defaults to the last 90 days', async () => {
    expect((await get(project)).body.range.from.slice(0, 10)).toBe(
      dateOnly(-90),
    );
  });

  it('validates the query', async () => {
    for (const qs of [
      `?from=${dateOnly(0)}&to=${dateOnly(-5)}`,
      range(-500),
      '?definition=banana',
      '?from=notadate',
    ]) {
      expect((await get(project, qs)).status).toBe(400);
    }
  });

  it('is visible to every member, but not to outsiders', async () => {
    expect((await get(project, '', viewer)).status).toBe(200);
    expect((await get(project, '', outsider)).status).toBe(404);
    expect((await ctx.api().get(`/projects/${project}/analytics`)).status).toBe(
      401,
    );
  });
});

describe('sprint comparison', () => {
  it('uses the recorded commitment for completed sprints in the range', async () => {
    const project = await projectIn(ctx.api, owner, ws, 'AS');
    const a = await taskIn(ctx.api, dev, project, {
      title: 'A',
      storyPoints: 3,
    });
    const b = await taskIn(ctx.api, dev, project, {
      title: 'B',
      storyPoints: 5,
    });
    const s = (
      await ctx.api(owner.token).post(`/projects/${project}/sprints`, {
        name: 'Sprint A',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      })
    ).body.id;
    for (const t of [a, b])
      await ctx.api(owner.token).patch(`/tasks/${t.id}`, { sprintId: s });
    await ctx.api(owner.token).post(`/sprints/${s}/start`);
    await ctx.api(dev.token).patch(`/tasks/${a.id}`, {
      statusId: await statusId(ctx.api, owner, project, 'Done'),
    });
    await ctx
      .api(owner.token)
      .post(`/sprints/${s}/complete`, { incompleteTo: 'BACKLOG' });

    const { sprints } = (await get(project, range(-1, 1))).body;
    expect(sprints).toHaveLength(1);
    expect(sprints[0]).toMatchObject({
      name: 'Sprint A',
      committedPoints: 8,
      completedPoints: 3,
      completionRate: 38,
    });
  });
});

describe('sprint comparison and scope changes', () => {
  it('doesn’t credit work added mid-sprint towards the committed completion rate', async () => {
    const project = await projectIn(ctx.api, owner, ws, 'AC');
    const committed = await taskIn(ctx.api, dev, project, {
      title: 'Committed',
      storyPoints: 3,
    });
    const added = await taskIn(ctx.api, dev, project, {
      title: 'Added later',
      storyPoints: 2,
    });
    const done = await statusId(ctx.api, owner, project, 'Done');
    const s = (
      await ctx.api(owner.token).post(`/projects/${project}/sprints`, {
        name: 'Scope',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      })
    ).body.id;
    await ctx.api(owner.token).patch(`/tasks/${committed.id}`, { sprintId: s });
    await ctx.api(owner.token).post(`/sprints/${s}/start`);
    await ctx.api(owner.token).patch(`/tasks/${added.id}`, { sprintId: s }); // scope added after the start
    await ctx
      .api(dev.token)
      .patch(`/tasks/${committed.id}`, { statusId: done });
    await ctx.api(dev.token).patch(`/tasks/${added.id}`, { statusId: done });
    await ctx
      .api(owner.token)
      .post(`/sprints/${s}/complete`, { incompleteTo: 'BACKLOG' });

    const { sprints } = (await get(project, range(-1, 1))).body;
    // 3 committed points were completed; the 2 added points are reported separately.
    expect(sprints[0]).toMatchObject({
      committedPoints: 3,
      completedPoints: 3,
      addedPoints: 2,
      completionRate: 100,
    });
    // The sprint report itself agrees.
    const report = (await ctx.api(owner.token).get(`/sprints/${s}/report`))
      .body;
    expect(report).toMatchObject({
      completedCommittedPoints: 3,
      completionRate: 100,
      completedPoints: 5,
    });
  });
});

describe('column changes never rewrite history', () => {
  it('keeps past cycle time and time-in-stage after a column is renamed, re-typed and deleted', async () => {
    const project = await projectIn(ctx.api, owner, ws, 'AH');
    const gate = (
      await ctx.api(owner.token).post(`/projects/${project}/statuses`, {
        name: 'Gate',
        category: 'IN_REVIEW',
      })
    ).body.id;
    const t = await taskIn(ctx.api, dev, project, { title: 'History' });
    await backdate(project, t.id, {
      created: -10,
      moves: [
        { to: 'In Progress', day: -8 },
        { to: 'Gate', day: -6 },
        { to: 'Done', day: -4 },
      ],
    });
    const metrics = async () => {
      const { cycleTime } = (await get(project, range(-30))).body;
      return {
        cycle: cycleTime.median,
        inProgress: cycleTime.timeInStage.inProgressDays,
        inReview: cycleTime.timeInStage.inReviewDays,
      };
    };
    const expected = { cycle: 4, inProgress: 2, inReview: 2 };
    expect(await metrics()).toEqual(expected);
    await ctx
      .api(owner.token)
      .patch(`/statuses/${gate}`, { name: 'Quality gate', category: 'TODO' });
    expect(await metrics()).toEqual(expected);
    await ctx.api(owner.token).delete(`/statuses/${gate}`);
    expect(await metrics()).toEqual(expected);
  });
});
