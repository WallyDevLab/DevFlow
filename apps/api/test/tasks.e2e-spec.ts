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
  scrum: TestUser,
  dev: TestUser,
  viewer: TestUser,
  outsider: TestUser;
let ws: string;

beforeAll(async () => {
  ctx = await createApp();
  [owner, scrum, dev, viewer, outsider] = await Promise.all(
    ['Owner', 'Scrum', 'Dev', 'Viewer', 'Outsider'].map((n) =>
      signup(ctx.api, n),
    ),
  );
  ws = await workspaceWith(ctx.api, owner, [
    [scrum, 'SCRUM_MASTER'],
    [dev, 'DEVELOPER'],
    [viewer, 'VIEWER'],
  ]);
});
afterAll(async () => {
  await ctx.app.close();
});

let keyN = 0;
const newProject = () =>
  projectIn(
    ctx.api,
    owner,
    ws,
    `P${String.fromCharCode(65 + (keyN++ % 26))}${Math.floor(keyN / 26)}`,
  );
const boardOf = async (project: string) =>
  (await ctx.api(dev.token).get(`/projects/${project}/boards`)).body
    .columns as {
    id: string;
    name: string;
    category: string;
    wipLimit: number | null;
    tasks: {
      id: string;
      key: string;
      title: string;
      labels: { name: string }[];
      blocked: boolean;
    }[];
  }[];
const historyOf = async (taskId: string) =>
  (await ctx.api(dev.token).get(`/tasks/${taskId}`)).body.activity as {
    type: string;
    data: Record<string, unknown> | null;
    actor: string;
  }[];

describe('projects', () => {
  it('creates a project with the default five-column workflow', async () => {
    const id = await newProject();
    const p = (await ctx.api(owner.token).get(`/projects/${id}`)).body;
    expect(p.statuses.map((s: { name: string }) => s.name)).toEqual([
      'Backlog',
      'To Do',
      'In Progress',
      'In Review',
      'Done',
    ]);
    expect(p.statuses.map((s: { category: string }) => s.category)).toEqual([
      'BACKLOG',
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ]);
  });

  it('upper-cases the project key and enforces its format and uniqueness per workspace', async () => {
    const ok = await ctx
      .api(owner.token)
      .post(`/workspaces/${ws}/projects`, { name: 'Keyed', key: 'abc' });
    expect(ok.body.key).toBe('ABC');
    for (const key of ['1ab', 'A', 'TOOLONG', 'a b', 'ab-c']) {
      expect(
        (
          await ctx
            .api(owner.token)
            .post(`/workspaces/${ws}/projects`, { name: 'Bad', key })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await ctx
          .api(owner.token)
          .post(`/workspaces/${ws}/projects`, { name: 'Again', key: 'ABC' })
      ).status,
    ).toBe(409);
  });

  it('allows the same key in different workspaces', async () => {
    const other = await workspaceWith(ctx.api, outsider, []);
    expect(
      (
        await ctx.api(outsider.token).post(`/workspaces/${other}/projects`, {
          name: 'Same Key',
          key: 'ABC',
        })
      ).status,
    ).toBe(201);
  });

  it('archives a project, after which no tasks can be created', async () => {
    const id = await newProject();
    expect(
      (
        await ctx
          .api(owner.token)
          .patch(`/projects/${id}`, { status: 'ARCHIVED' })
      ).body.status,
    ).toBe('ARCHIVED');
    expect(
      (
        await ctx
          .api(dev.token)
          .post(`/projects/${id}/tasks`, { title: 'late' })
      ).status,
    ).toBe(400);
  });
});

describe('tasks', () => {
  let project: string;
  beforeAll(async () => {
    project = await newProject();
  });

  it('numbers tasks sequentially within the project and starts them in the first column', async () => {
    const a = await taskIn(ctx.api, dev, project, { title: 'One' });
    const b = await taskIn(ctx.api, dev, project, { title: 'Two' });
    const prefix = a.key.split('-')[0];
    expect([a.key, b.key]).toEqual([`${prefix}-1`, `${prefix}-2`]);
    const board = await boardOf(project);
    expect(board[0].tasks.map((t) => t.title)).toEqual(['One', 'Two']);
  });

  it('numbers concurrently created tasks uniquely', async () => {
    const p = await newProject();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        taskIn(ctx.api, dev, p, { title: `T${i}` }),
      ),
    );
    expect(new Set(results.map((r) => r.key)).size).toBe(8);
  });

  it('requires a title and rejects unknown or oversized input', async () => {
    expect(
      (
        await ctx
          .api(dev.token)
          .post(`/projects/${project}/tasks`, { title: '  ' })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api(dev.token)
          .post(`/projects/${project}/tasks`, { title: 'x'.repeat(201) })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.api(dev.token).post(`/projects/${project}/tasks`, {
          title: 'ok',
          reporterId: dev.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api(dev.token)
          .post(`/projects/${project}/tasks`, { title: 'ok', storyPoints: -1 })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.api(dev.token).post(`/projects/${project}/tasks`, {
          title: 'ok',
          priority: 'URGENT',
        })
      ).status,
    ).toBe(400);
  });

  it('only lets workspace members be assigned', async () => {
    const t = await taskIn(ctx.api, dev, project);
    expect(
      (
        await ctx
          .api(dev.token)
          .patch(`/tasks/${t.id}`, { assigneeId: outsider.id })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api(dev.token)
          .patch(`/tasks/${t.id}`, { assigneeId: scrum.id })
      ).status,
    ).toBe(204);
    expect(
      (await ctx.api(dev.token).patch(`/tasks/${t.id}`, { assigneeId: null }))
        .status,
    ).toBe(204);
    expect(
      (await ctx.api(dev.token).get(`/tasks/${t.id}`)).body.assignee,
    ).toBeNull();
  });

  it('can’t move a task into a status from another project', async () => {
    const other = await newProject();
    const foreign = await statusId(ctx.api, owner, other, 'Done');
    const t = await taskIn(ctx.api, dev, project);
    expect(
      (await ctx.api(dev.token).patch(`/tasks/${t.id}`, { statusId: foreign }))
        .status,
    ).toBe(400);
    expect(
      (
        await ctx.api(dev.token).patch(`/tasks/${t.id}`, {
          statusId: '00000000-0000-4000-8000-000000000000',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api(dev.token)
          .patch(`/tasks/${t.id}`, { statusId: 'not-a-uuid' })
      ).status,
    ).toBe(400);
  });

  it('keeps all task data when moved between columns and persists the order', async () => {
    const p = await newProject();
    const t = await taskIn(ctx.api, dev, p, {
      title: 'Keep me',
      storyPoints: 5,
      priority: 'HIGH',
    });
    const inProgress = await statusId(ctx.api, owner, p, 'In Progress');
    await ctx.api(dev.token).patch(`/tasks/${t.id}`, { statusId: inProgress });
    const view = (await ctx.api(dev.token).get(`/tasks/${t.id}`)).body;
    expect(view).toMatchObject({
      title: 'Keep me',
      storyPoints: 5,
      priority: 'HIGH',
      status: { name: 'In Progress' },
    });
    const board = await boardOf(p);
    expect(
      board.find((c) => c.name === 'In Progress')!.tasks.map((x) => x.id),
    ).toEqual([t.id]);
  });

  it('orders tasks in a column by the position given', async () => {
    const p = await newProject();
    await taskIn(ctx.api, dev, p, { title: 'A' });
    await taskIn(ctx.api, dev, p, { title: 'B' });
    const c = await taskIn(ctx.api, dev, p, { title: 'C' });
    await ctx.api(dev.token).patch(`/tasks/${c.id}`, { position: 1 }); // before A and B
    expect((await boardOf(p))[0].tasks.map((t) => t.title)).toEqual([
      'C',
      'A',
      'B',
    ]);
  });

  it('records every meaningful change in the task history, with who did it', async () => {
    const p = await newProject();
    const t = await taskIn(ctx.api, dev, p, { title: 'Tracked' });
    const review = await statusId(ctx.api, owner, p, 'In Review');
    await ctx.api(scrum.token).patch(`/tasks/${t.id}`, { statusId: review });
    await ctx
      .api(dev.token)
      .patch(`/tasks/${t.id}`, { priority: 'CRITICAL', assigneeId: scrum.id });
    await ctx.api(dev.token).patch(`/tasks/${t.id}`, {
      blocked: true,
      blockedReason: 'waiting on keys',
    });
    await ctx.api(dev.token).patch(`/tasks/${t.id}`, { blocked: false });
    const types = (await historyOf(t.id)).map((a) => a.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'created',
        'status_changed',
        'priority_changed',
        'assigned',
        'blocked',
        'unblocked',
      ]),
    );
    const moved = (await historyOf(t.id)).find(
      (a) => a.type === 'status_changed',
    )!;
    expect(moved.data).toMatchObject({
      from: 'Backlog',
      to: 'In Review',
      fromCategory: 'BACKLOG',
      toCategory: 'IN_REVIEW',
    });
    expect(moved.actor).toBe('Scrum');
    expect(
      (await historyOf(t.id)).find((a) => a.type === 'blocked')!.data,
    ).toEqual({ reason: 'waiting on keys' });
  });

  it('records nothing when an update changes nothing', async () => {
    const t = await taskIn(ctx.api, dev, project, {
      title: 'Same',
      priority: 'LOW',
    });
    const before = (await historyOf(t.id)).length;
    await ctx
      .api(dev.token)
      .patch(`/tasks/${t.id}`, { title: 'Same', priority: 'LOW' });
    expect((await historyOf(t.id)).length).toBe(before);
  });

  it('marks blocked tasks on the board and clears the reason when unblocked', async () => {
    const p = await newProject();
    const t = await taskIn(ctx.api, dev, p);
    await ctx
      .api(dev.token)
      .patch(`/tasks/${t.id}`, { blocked: true, blockedReason: 'why' });
    expect((await boardOf(p))[0].tasks[0].blocked).toBe(true);
    await ctx.api(dev.token).patch(`/tasks/${t.id}`, { blocked: false });
    expect((await ctx.api(dev.token).get(`/tasks/${t.id}`)).body).toMatchObject(
      { blocked: false, blockedReason: null },
    );
  });

  it('deletes a task together with its history', async () => {
    const t = await taskIn(ctx.api, dev, project, { title: 'Doomed' });
    expect((await ctx.api(dev.token).delete(`/tasks/${t.id}`)).status).toBe(
      204,
    );
    expect((await ctx.api(dev.token).get(`/tasks/${t.id}`)).status).toBe(404);
    expect(
      await ctx.prisma.taskActivity.count({ where: { taskId: t.id } }),
    ).toBe(0);
  });
});

describe('labels', () => {
  let project: string, task: { id: string };
  beforeAll(async () => {
    project = await newProject();
    task = await taskIn(ctx.api, dev, project);
  });
  const mk = (name: string, color = '#3987e5') =>
    ctx.api(dev.token).post(`/projects/${project}/labels`, { name, color });

  it('creates labels (trimmed, colour lower-cased) and refuses duplicates in any case', async () => {
    const res = await mk('  Bug ', '#D95926');
    expect(res.body).toMatchObject({ name: 'Bug', color: '#d95926' });
    expect((await mk('bug')).status).toBe(409);
  });

  it('only accepts #rrggbb colours (no CSS injection)', async () => {
    for (const color of ['red', '#fff', '#12345g', '#fff;background:url(x)']) {
      expect(
        (await mk(`c-${color.length}${color.charCodeAt(1)}`, color)).status,
      ).toBe(400);
    }
  });

  it('assigns, replaces and removes labels, recording changes only when something changed', async () => {
    const a = (await mk('alpha')).body.id,
      b = (await mk('beta')).body.id;
    await ctx.api(dev.token).patch(`/tasks/${task.id}`, { labelIds: [a, b] });
    expect(
      (await ctx.api(dev.token).get(`/tasks/${task.id}`)).body.labels.map(
        (l: { name: string }) => l.name,
      ),
    ).toEqual(['alpha', 'beta']);
    const before = (await historyOf(task.id)).filter(
      (h) => h.type === 'labels_changed',
    ).length;
    await ctx
      .api(dev.token)
      .patch(`/tasks/${task.id}`, { labelIds: [b, a, a] }); // same set
    expect(
      (await historyOf(task.id)).filter((h) => h.type === 'labels_changed')
        .length,
    ).toBe(before);
    await ctx.api(dev.token).patch(`/tasks/${task.id}`, { labelIds: [b] });
    expect(
      (await historyOf(task.id)).find((h) => h.type === 'labels_changed')!.data,
    ).toMatchObject({ removed: ['alpha'] });
  });

  it('rejects labels from another project', async () => {
    const other = await newProject();
    const foreign = (
      await ctx
        .api(owner.token)
        .post(`/projects/${other}/labels`, { name: 'x', color: '#000000' })
    ).body.id;
    expect(
      (
        await ctx
          .api(dev.token)
          .patch(`/tasks/${task.id}`, { labelIds: [foreign] })
      ).status,
    ).toBe(400);
  });

  it('shows labels on the board and removes a deleted label from every task', async () => {
    const l = (await mk('temp')).body.id;
    await ctx.api(dev.token).patch(`/tasks/${task.id}`, { labelIds: [l] });
    expect(
      (await boardOf(project))[0].tasks.find((t) => t.id === task.id)!.labels[0]
        .name,
    ).toBe('temp');
    expect((await ctx.api(scrum.token).delete(`/labels/${l}`)).status).toBe(
      204,
    );
    expect(
      (await ctx.api(dev.token).get(`/tasks/${task.id}`)).body.labels,
    ).toEqual([]);
  });

  it('applies the duplicate rule on rename too', async () => {
    const x = (await mk('first-one')).body.id;
    await mk('second-one');
    expect(
      (await ctx.api(scrum.token).patch(`/labels/${x}`, { name: 'SECOND-ONE' }))
        .status,
    ).toBe(409);
    expect(
      (await ctx.api(scrum.token).patch(`/labels/${x}`, { name: 'First-One' }))
        .status,
    ).toBe(200);
  });
});

describe('comments', () => {
  let task: { id: string };
  beforeAll(async () => {
    task = await taskIn(ctx.api, dev, await newProject());
  });

  it('stores comment text verbatim, as plain text, oldest first', async () => {
    const html = '<script>alert(1)</script>\nsecond line';
    await ctx
      .api(dev.token)
      .post(`/tasks/${task.id}/comments`, { body: `  ${html}  ` });
    await ctx
      .api(scrum.token)
      .post(`/tasks/${task.id}/comments`, { body: 'later' });
    const list = (await ctx.api(viewer.token).get(`/tasks/${task.id}/comments`))
      .body;
    expect(list.map((c: { body: string }) => c.body)).toEqual([html, 'later']);
  });

  it('validates comment bodies', async () => {
    expect(
      (
        await ctx
          .api(dev.token)
          .post(`/tasks/${task.id}/comments`, { body: '   ' })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .api(dev.token)
          .post(`/tasks/${task.id}/comments`, { body: 'x'.repeat(5001) })
      ).status,
    ).toBe(400);
  });

  it('marks edited comments and reports per-viewer edit/delete rights', async () => {
    const id = (
      await ctx
        .api(dev.token)
        .post(`/tasks/${task.id}/comments`, { body: 'draft' })
    ).body.id;
    await ctx.api(dev.token).patch(`/comments/${id}`, { body: 'final' });
    const asDev = (
      await ctx.api(dev.token).get(`/tasks/${task.id}/comments`)
    ).body.find((c: { id: string }) => c.id === id);
    const asScrum = (
      await ctx.api(scrum.token).get(`/tasks/${task.id}/comments`)
    ).body.find((c: { id: string }) => c.id === id);
    expect(asDev).toMatchObject({
      body: 'final',
      edited: true,
      canEdit: true,
      canDelete: true,
    });
    expect(asScrum).toMatchObject({ canEdit: false, canDelete: true });
  });
});

describe('board columns', () => {
  let project: string;
  beforeEach(async () => {
    project = await newProject();
  });
  const add = (body: object, u = scrum) =>
    ctx.api(u.token).post(`/projects/${project}/statuses`, body);
  const names = async () => (await boardOf(project)).map((c) => c.name);

  it('inserts work columns before Done and Done columns last', async () => {
    await add({ name: 'Testing', category: 'IN_REVIEW', wipLimit: 2 });
    await add({ name: 'Released', category: 'DONE' });
    expect(await names()).toEqual([
      'Backlog',
      'To Do',
      'In Progress',
      'In Review',
      'Testing',
      'Done',
      'Released',
    ]);
    expect(
      (await boardOf(project)).find((c) => c.name === 'Testing')!.wipLimit,
    ).toBe(2);
  });

  it('validates names, categories and WIP limits', async () => {
    expect((await add({ name: 'In Review', category: 'TODO' })).status).toBe(
      409,
    );
    expect((await add({ name: 'in review', category: 'TODO' })).status).toBe(
      409,
    );
    expect((await add({ name: ' ', category: 'TODO' })).status).toBe(400);
    expect((await add({ name: 'X', category: 'LATER' })).status).toBe(400);
    expect(
      (await add({ name: 'X', category: 'TODO', wipLimit: 0 })).status,
    ).toBe(400);
    expect(
      (await add({ name: 'X', category: 'TODO', wipLimit: 100 })).status,
    ).toBe(400);
  });

  it('allows at most 12 columns', async () => {
    for (let i = 0; i < 7; i++)
      expect((await add({ name: `Col ${i}`, category: 'TODO' })).status).toBe(
        201,
      );
    expect((await add({ name: 'One too many', category: 'TODO' })).status).toBe(
      400,
    );
  });

  it('renames, sets and clears WIP limits', async () => {
    const id = (await add({ name: 'Doing', category: 'IN_PROGRESS' })).body.id;
    expect(
      (
        await ctx
          .api(scrum.token)
          .patch(`/statuses/${id}`, { name: 'Active', wipLimit: 3 })
      ).body,
    ).toMatchObject({ name: 'Active', wipLimit: 3 });
    expect(
      (await ctx.api(scrum.token).patch(`/statuses/${id}`, { wipLimit: null }))
        .body.wipLimit,
    ).toBeNull();
    expect(
      (await ctx.api(scrum.token).patch(`/statuses/${id}`, { name: 'done' }))
        .status,
    ).toBe(409);
  });

  it('always keeps a Done column and a non-Done column', async () => {
    const done = await statusId(ctx.api, owner, project, 'Done');
    expect(
      (
        await ctx
          .api(scrum.token)
          .patch(`/statuses/${done}`, { category: 'TODO' })
      ).status,
    ).toBe(400);
    expect(
      (await ctx.api(scrum.token).delete(`/statuses/${done}`)).status,
    ).toBe(400);
    const ids = (await boardOf(project)).filter((c) => c.category !== 'DONE');
    for (const c of ids.slice(0, -1))
      expect(
        (await ctx.api(scrum.token).delete(`/statuses/${c.id}`)).status,
      ).toBe(200);
    expect(
      (await ctx.api(scrum.token).delete(`/statuses/${ids.at(-1)!.id}`)).status,
    ).toBe(400);
  });

  it('reorders only with exactly the board’s own columns', async () => {
    const ids = (await boardOf(project)).map((c) => c.id);
    const swapped = [ids[1], ids[0], ...ids.slice(2)];
    expect(
      (
        await ctx
          .api(scrum.token)
          .put(`/projects/${project}/statuses/order`, { ids: swapped })
      ).status,
    ).toBe(204);
    expect((await boardOf(project)).map((c) => c.id)).toEqual(swapped);
    const foreign = await statusId(ctx.api, owner, await newProject(), 'Done');
    for (const bad of [
      swapped.slice(1),
      [...swapped.slice(1), swapped[1]],
      [...swapped.slice(1), foreign],
    ]) {
      expect(
        (
          await ctx
            .api(scrum.token)
            .put(`/projects/${project}/statuses/order`, { ids: bad })
        ).status,
      ).toBe(400);
    }
  });

  it('deleting a column moves its tasks, in order, and records it in their history', async () => {
    const col = (await add({ name: 'QA', category: 'IN_REVIEW' })).body.id;
    const todo = await statusId(ctx.api, owner, project, 'To Do');
    const a = await taskIn(ctx.api, dev, project, {
      title: 'A',
      statusId: col,
    });
    await taskIn(ctx.api, dev, project, { title: 'B', statusId: col });
    expect((await ctx.api(scrum.token).delete(`/statuses/${col}`)).status).toBe(
      400,
    ); // needs a target
    expect(
      (await ctx.api(scrum.token).delete(`/statuses/${col}?moveTo=${col}`))
        .status,
    ).toBe(400);
    const res = await ctx
      .api(scrum.token)
      .delete(`/statuses/${col}?moveTo=${todo}`);
    expect(res.body.moved).toBe(2);
    expect(
      (await boardOf(project))
        .find((c) => c.name === 'To Do')!
        .tasks.map((t) => t.title),
    ).toEqual(['A', 'B']);
    expect(
      (await historyOf(a.id)).find((h) => h.type === 'status_changed')!.data,
    ).toMatchObject({
      from: 'QA',
      to: 'To Do',
      fromCategory: 'IN_REVIEW',
      toCategory: 'TODO',
    });
  });

  it('counts a custom Done column as completed work in a sprint', async () => {
    const released = (await add({ name: 'Released', category: 'DONE' })).body
      .id;
    const t = await taskIn(ctx.api, dev, project, {
      title: 'Shipped',
      storyPoints: 3,
    });
    const sprint = (
      await ctx.api(owner.token).post(`/projects/${project}/sprints`, {
        name: 'S',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      })
    ).body.id;
    await ctx.api(owner.token).patch(`/tasks/${t.id}`, { sprintId: sprint });
    await ctx.api(owner.token).post(`/sprints/${sprint}/start`);
    await ctx.api(dev.token).patch(`/tasks/${t.id}`, { statusId: released });
    await ctx
      .api(owner.token)
      .post(`/sprints/${sprint}/complete`, { incompleteTo: 'BACKLOG' });
    const report = (await ctx.api(owner.token).get(`/sprints/${sprint}/report`))
      .body;
    expect(report.completed.map((x: { key: string }) => x.key)).toEqual([
      t.key,
    ]);
    expect(report.incomplete).toEqual([]);
  });
});
