import {
  buildTimeline,
  computeAnalytics,
  summarise,
  weekStart,
  type AnalyticsInput,
  type Category,
  type StatusMap,
  type TaskInput,
} from './analytics.calc.js';

const BASE = Date.UTC(2026, 10, 2); // Monday 2 Nov 2026
const day = (n: number) => new Date(BASE + n * 86_400_000);

const STATUSES: { name: string; category: Category }[] = [
  { name: 'Backlog', category: 'BACKLOG' },
  { name: 'To Do', category: 'TODO' },
  { name: 'In Progress', category: 'IN_PROGRESS' },
  { name: 'In Review', category: 'IN_REVIEW' },
  { name: 'Done', category: 'DONE' },
];
const MAP: StatusMap = new Map(STATUSES.map((s) => [s.name, s.category]));

const move = (n: number, from: string, to: string) => ({
  type: 'status_changed',
  data: { from, to },
  at: day(n),
});

function task(over: Partial<TaskInput> = {}): TaskInput {
  return {
    id: 't1',
    key: 'DEV-1',
    title: 'Task',
    createdAt: day(0),
    createdStatus: 'Backlog',
    currentStatus: 'Done',
    blocked: false,
    blockedReason: null,
    events: [],
    mergedAt: null,
    ...over,
  };
}

// A task that runs the full workflow: started day 2, done day 6.
const fullRun = () =>
  task({
    events: [
      move(1, 'Backlog', 'To Do'),
      move(2, 'To Do', 'In Progress'),
      move(4, 'In Progress', 'In Review'),
      move(6, 'In Review', 'Done'),
    ],
  });

function input(over: Partial<AnalyticsInput> = {}): AnalyticsInput {
  return {
    tasks: [],
    statuses: STATUSES,
    sprints: [],
    pullRequests: [],
    from: day(0),
    to: day(30),
    definition: 'done',
    now: day(20),
    ...over,
  };
}

describe('summarise', () => {
  it('computes average, median and p85', () => {
    const s = summarise([1, 2, 3, 4, 5]);
    expect(s).toMatchObject({
      n: 5,
      average: 3,
      median: 3,
      p85: 4.4,
      lowSample: false,
    });
  });

  it('flags samples below five as small', () => {
    expect(summarise([1, 2, 3, 4]).lowSample).toBe(true);
  });

  it('handles an empty set without NaN', () => {
    expect(summarise([])).toEqual({
      n: 0,
      average: null,
      median: null,
      p85: null,
      lowSample: true,
    });
  });

  it('uses the median so one outlier does not dominate', () => {
    const s = summarise([1, 1, 1, 1, 100]);
    expect(s.median).toBe(1);
    expect(s.average).toBeGreaterThan(20);
  });
});

describe('buildTimeline', () => {
  it('measures cycle from first active state to Done', () => {
    const tl = buildTimeline(fullRun(), MAP, day(20));
    expect(tl.startedAt).toEqual(day(2));
    expect(tl.completedAt).toEqual(day(6));
  });

  it('splits time between stages', () => {
    const { stageMs } = buildTimeline(fullRun(), MAP, day(20));
    const d = (ms: number) => ms / 86_400_000;
    expect(d(stageMs.BACKLOG)).toBe(1);
    expect(d(stageMs.TODO)).toBe(1);
    expect(d(stageMs.IN_PROGRESS)).toBe(2);
    expect(d(stageMs.IN_REVIEW)).toBe(2);
    expect(d(stageMs.DONE)).toBe(0); // time after completion isn't counted
  });

  it('does not count a reopened task as completed', () => {
    const t = task({
      currentStatus: 'In Progress',
      events: [
        move(2, 'Backlog', 'In Progress'),
        move(4, 'In Progress', 'Done'),
        move(5, 'Done', 'In Progress'),
      ],
    });
    expect(buildTimeline(t, MAP, day(20)).completedAt).toBeNull();
  });

  it('uses the latest completion if a task was reopened and finished again', () => {
    const t = task({
      events: [
        move(2, 'Backlog', 'In Progress'),
        move(4, 'In Progress', 'Done'),
        move(5, 'Done', 'In Progress'),
        move(9, 'In Progress', 'Done'),
      ],
    });
    const tl = buildTimeline(t, MAP, day(20));
    expect(tl.startedAt).toEqual(day(2)); // first start is kept
    expect(tl.completedAt).toEqual(day(9));
  });

  it('has no start when work jumps straight to Done', () => {
    const t = task({ events: [move(3, 'Backlog', 'Done')] });
    const tl = buildTimeline(t, MAP, day(20));
    expect(tl.startedAt).toBeNull();
    expect(tl.completedAt).toEqual(day(3));
  });

  it('records blocked intervals, open ones running to now', () => {
    const t = task({
      currentStatus: 'In Progress',
      blocked: true,
      events: [
        move(1, 'Backlog', 'In Progress'),
        { type: 'blocked', data: null, at: day(2) },
        { type: 'unblocked', data: null, at: day(3) },
        { type: 'blocked', data: null, at: day(5) },
      ],
    });
    const { blocked } = buildTimeline(t, MAP, day(10));
    expect(blocked).toEqual([
      { start: day(2), end: day(3) },
      { start: day(5), end: day(10) },
    ]);
  });
});

describe('renamed and re-categorised columns', () => {
  // Events that carry the category recorded at the time of the move.
  const moveCat = (
    n: number,
    from: string,
    to: string,
    fromCategory: Category,
    toCategory: Category,
  ) => ({
    type: 'status_changed',
    data: { from, to, fromCategory, toCategory },
    at: day(n),
  });

  it('keeps history meaningful when old status names no longer exist', () => {
    // "Doing" and "QA" were later renamed/deleted, so the current status map
    // knows nothing about them. The recorded categories still give the answer.
    const t = task({
      createdStatus: 'Ideas',
      createdCategory: 'BACKLOG',
      currentStatus: 'Shipped',
      currentCategory: 'DONE',
      events: [
        moveCat(2, 'Ideas', 'Doing', 'BACKLOG', 'IN_PROGRESS'),
        moveCat(4, 'Doing', 'QA', 'IN_PROGRESS', 'IN_REVIEW'),
        moveCat(6, 'QA', 'Shipped', 'IN_REVIEW', 'DONE'),
      ],
    });
    const tl = buildTimeline(t, MAP, day(20));
    expect(tl.startedAt).toEqual(day(2));
    expect(tl.completedAt).toEqual(day(6));
    const d = (ms: number) => ms / 86_400_000;
    expect(d(tl.stageMs.IN_PROGRESS)).toBe(2);
    expect(d(tl.stageMs.IN_REVIEW)).toBe(2);
  });

  it('a recorded category overrides what the status name maps to today', () => {
    // The column called "In Progress" is today categorised as DONE (someone
    // changed it), but when this task moved, it counted as active work.
    const remapped: StatusMap = new Map([
      ...MAP,
      ['In Progress', 'DONE' as Category],
    ]);
    const t = task({
      createdCategory: 'BACKLOG',
      currentCategory: 'DONE',
      events: [
        moveCat(2, 'Backlog', 'In Progress', 'BACKLOG', 'IN_PROGRESS'),
        moveCat(5, 'In Progress', 'Done', 'IN_PROGRESS', 'DONE'),
      ],
    });
    const tl = buildTimeline(t, remapped, day(20));
    expect(tl.startedAt).toEqual(day(2));
    expect(tl.completedAt).toEqual(day(5));
  });

  it('uses the current category, not the name, to decide if a task is done', () => {
    const t = task({
      currentStatus: 'Renamed column',
      currentCategory: 'IN_PROGRESS',
      events: [
        moveCat(2, 'Backlog', 'Renamed column', 'BACKLOG', 'IN_PROGRESS'),
      ],
    });
    expect(buildTimeline(t, MAP, day(20)).completedAt).toBeNull();
    const r = computeAnalytics(input({ tasks: [t] }));
    expect(r.wip.total).toBe(1);
  });

  it('falls back to name matching for events recorded before categories existed', () => {
    const legacy = task({
      createdCategory: undefined,
      currentCategory: undefined,
      events: [
        move(2, 'Backlog', 'In Progress'),
        move(5, 'In Progress', 'Done'),
      ],
    });
    const tl = buildTimeline(legacy, MAP, day(20));
    expect(tl.startedAt).toEqual(day(2));
    expect(tl.completedAt).toEqual(day(5));
  });
});

describe('weekStart', () => {
  it('returns the Monday of the week', () => {
    expect(weekStart(day(0))).toEqual(day(0)); // Monday
    expect(weekStart(day(6))).toEqual(day(0)); // Sunday
    expect(weekStart(day(7))).toEqual(day(7)); // next Monday
  });
});

describe('computeAnalytics', () => {
  it('computes cycle and lead time for delivered work', () => {
    const r = computeAnalytics(input({ tasks: [fullRun()] }));
    expect(r.cycleTime.median).toBe(4);
    expect(r.leadTime.median).toBe(6);
    expect(r.cycleTime.timeInStage).toMatchObject({
      inProgressDays: 2,
      inReviewDays: 2,
    });
  });

  it('flags small samples instead of implying precision', () => {
    const r = computeAnalytics(input({ tasks: [fullRun()] }));
    expect(r.cycleTime.lowSample).toBe(true);
  });

  it('only includes work completed inside the date range', () => {
    const r = computeAnalytics(
      input({ tasks: [fullRun()], from: day(10), to: day(30) }),
    );
    expect(r.cycleTime.n).toBe(0);
    expect(r.completedTasks).toHaveLength(0);
  });

  it('measures lead time to merge when that definition is chosen', () => {
    const t = { ...fullRun(), mergedAt: day(5) };
    const r = computeAnalytics(input({ tasks: [t], definition: 'merged' }));
    expect(r.leadTime.median).toBe(5);
    expect(r.cycleTime.median).toBe(4); // cycle time still ends at Done
  });

  it('excludes tasks that were never merged from merge-based lead time', () => {
    const r = computeAnalytics(
      input({ tasks: [fullRun()], definition: 'merged' }),
    );
    expect(r.leadTime.n).toBe(0);
  });

  it('does not report cycle time for work that skipped the active states', () => {
    const t = task({ events: [move(3, 'Backlog', 'Done')] });
    const r = computeAnalytics(input({ tasks: [t] }));
    expect(r.cycleTime.n).toBe(0);
    expect(r.completedTasks).toHaveLength(1);
    expect(r.completedTasks[0].cycleDays).toBeNull();
  });

  it('counts current WIP and blocked work', () => {
    const wip = task({
      id: 'a',
      key: 'DEV-2',
      currentStatus: 'In Progress',
      blocked: true,
      blockedReason: 'Waiting on keys',
      events: [
        move(1, 'Backlog', 'In Progress'),
        { type: 'blocked', data: null, at: day(15) },
      ],
    });
    const review = task({
      id: 'b',
      key: 'DEV-3',
      currentStatus: 'In Review',
      events: [move(1, 'Backlog', 'In Review')],
    });
    const backlog = task({ id: 'c', key: 'DEV-4', currentStatus: 'Backlog' });
    const r = computeAnalytics(input({ tasks: [wip, review, backlog] }));
    expect(r.wip.total).toBe(2);
    expect(r.wip.byStatus.find((s) => s.name === 'Backlog')?.count).toBe(1);
    expect(r.blocked.current).toEqual([
      expect.objectContaining({
        key: 'DEV-2',
        days: 5,
        reason: 'Waiting on keys',
      }),
    ]);
  });

  it('adds up blocked time across multiple intervals', () => {
    const t = task({
      events: [
        move(1, 'Backlog', 'In Progress'),
        { type: 'blocked', data: null, at: day(2) },
        { type: 'unblocked', data: null, at: day(3) },
        { type: 'blocked', data: null, at: day(4) },
        { type: 'unblocked', data: null, at: day(6) },
        move(8, 'In Progress', 'Done'),
      ],
    });
    const r = computeAnalytics(input({ tasks: [t] }));
    expect(r.blocked.totalDays).toBe(3);
    expect(r.completedTasks[0].blockedDays).toBe(3);
  });

  it('buckets throughput by week', () => {
    const early = fullRun(); // done day 6 -> week of day 0
    const late = task({
      id: 'x',
      key: 'DEV-9',
      events: [
        move(8, 'Backlog', 'In Progress'),
        move(9, 'In Progress', 'Done'),
      ],
    }); // done day 9 -> week of day 7
    const r = computeAnalytics(input({ tasks: [early, late], to: day(14) }));
    expect(r.weekly.map((w) => w.completed)).toEqual([1, 1, 0]);
  });

  it('keeps sprint commitments as recorded, filtered by completion date', () => {
    const r = computeAnalytics(
      input({
        sprints: [
          {
            id: 's1',
            name: 'S1',
            completedAt: day(10),
            committedPoints: 8,
            completedCommittedPoints: 3,
            addedPoints: 2,
            removedPoints: 0,
          },
          {
            id: 's2',
            name: 'S2',
            completedAt: day(60),
            committedPoints: 5,
            completedCommittedPoints: 5,
            addedPoints: 0,
            removedPoints: 0,
          },
        ],
      }),
    );
    expect(r.sprints).toHaveLength(1);
    expect(r.sprints[0]).toMatchObject({
      name: 'S1',
      completionRate: 38,
      addedPoints: 2,
    });
  });

  it('gives no completion rate for a sprint with nothing committed', () => {
    const r = computeAnalytics(
      input({
        sprints: [
          {
            id: 's',
            name: 'Empty',
            completedAt: day(5),
            committedPoints: 0,
            completedCommittedPoints: 0,
            addedPoints: 0,
            removedPoints: 0,
          },
        ],
      }),
    );
    expect(r.sprints[0].completionRate).toBeNull();
  });

  it('summarises pull request activity', () => {
    const r = computeAnalytics(
      input({
        pullRequests: [
          { openedAt: day(1), mergedAt: day(2) }, // 24h
          { openedAt: day(3), mergedAt: day(5) }, // 48h
          { openedAt: day(4), mergedAt: null },
        ],
      }),
    );
    expect(r.github).toMatchObject({
      opened: 3,
      merged: 2,
      medianHoursToMerge: 36,
      lowSample: true,
    });
  });

  it('never exposes per-person data', () => {
    const r = computeAnalytics(input({ tasks: [fullRun()] }));
    expect(JSON.stringify(r)).not.toMatch(/assignee|author|reporter|userId/i);
  });
});
