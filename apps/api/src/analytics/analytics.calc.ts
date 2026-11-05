/**
 * Delivery metrics, derived purely from recorded events (task history, sprint
 * events, pull requests) rather than from mutable counters. Nothing here is
 * per-person: metrics describe the workflow, not individuals.
 */

export type Category =
  'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';

export interface TaskEvent {
  type: string;
  data: Record<string, unknown> | null;
  at: Date;
}

export interface TaskInput {
  id: string;
  key: string;
  title: string;
  createdAt: Date;
  /** Name of the status the task was created in (from its `created` event). */
  createdStatus: string | null;
  /** Category recorded on the `created` event, when present. */
  createdCategory?: Category | null;
  currentStatus: string;
  /** Category of the task's current status. */
  currentCategory?: Category | null;
  blocked: boolean;
  blockedReason: string | null;
  events: TaskEvent[];
  /** Earliest merge time among the task's linked pull requests, if any. */
  mergedAt: Date | null;
}

export type StatusMap = Map<string, Category>;
export type Definition = 'done' | 'merged';

const DAY = 86_400_000;
const days = (ms: number) => ms / DAY;
export const round = (n: number, dp = 1) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Below this many data points a metric is flagged as a small sample. */
export const MIN_SAMPLE = 5;

// ---- Statistics ------------------------------------------------------------

export function summarise(values: number[]) {
  const n = values.length;
  if (!n) {
    return { n, average: null, median: null, p85: null, lowSample: true };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number) => {
    // Linear interpolation between closest ranks.
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  return {
    n,
    average: round(sorted.reduce((a, b) => a + b, 0) / n),
    median: round(pick(0.5)),
    p85: round(pick(0.85)),
    lowSample: n < MIN_SAMPLE,
  };
}

// ---- Timeline derivation ---------------------------------------------------

export interface Timeline {
  startedAt: Date | null;
  completedAt: Date | null;
  /** Milliseconds spent in each category, up to completion (or `now`). */
  stageMs: Record<Category, number>;
  blocked: { start: Date; end: Date }[];
}

export function buildTimeline(
  task: TaskInput,
  statuses: StatusMap,
  now: Date,
): Timeline {
  const CATEGORIES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];
  // A category recorded on the event wins; matching by status name is only the
  // fallback for events written before categories were stored.
  const catOf = (recorded: unknown, name: string | null): Category | null =>
    typeof recorded === 'string' && CATEGORIES.includes(recorded)
      ? (recorded as Category)
      : name
        ? (statuses.get(name) ?? null)
        : null;

  const transitions = task.events
    .filter((e) => e.type === 'status_changed')
    .sort((a, b) => +a.at - +b.at)
    .map((e) => {
      const from = typeof e.data?.from === 'string' ? e.data.from : '';
      const to = typeof e.data?.to === 'string' ? e.data.to : '';
      return {
        from,
        to,
        fromCat: catOf(e.data?.fromCategory, from),
        toCat: catOf(e.data?.toCategory, to),
        at: e.at,
      };
    });

  // Where the task began its life.
  const first = transitions[0];
  const initialCat =
    catOf(task.createdCategory, task.createdStatus) ?? first?.fromCat ?? null;
  const currentCat = task.currentCategory ?? catOf(null, task.currentStatus);

  let startedAt: Date | null = null;
  if (initialCat === 'IN_PROGRESS' || initialCat === 'IN_REVIEW')
    startedAt = task.createdAt;
  let completedAt: Date | null = initialCat === 'DONE' ? task.createdAt : null;

  for (const t of transitions) {
    // Cycle time starts the first time work becomes active.
    if (!startedAt && (t.toCat === 'IN_PROGRESS' || t.toCat === 'IN_REVIEW'))
      startedAt = t.at;
    // Completion is the most recent entry into a done state; leaving Done
    // (a reopen) clears it, so reopened tasks aren't counted as delivered.
    if (t.toCat === 'DONE') completedAt = t.at;
    else if (completedAt) completedAt = null;
  }
  if (currentCat !== 'DONE') completedAt = null;

  // Time per category, built from consecutive status segments.
  const stageMs: Record<Category, number> = {
    BACKLOG: 0,
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    DONE: 0,
  };
  const end = completedAt ?? now;
  let segStart = task.createdAt;
  let segCat = initialCat;
  const close = (until: Date) => {
    if (segCat && +until > +segStart) stageMs[segCat] += +until - +segStart;
  };
  for (const t of transitions) {
    close(t.at);
    segStart = t.at;
    segCat = t.toCat;
  }
  close(end);

  // Blocked intervals; an unmatched `blocked` stays open until completion/now.
  const blocked: { start: Date; end: Date }[] = [];
  let open: Date | null = null;
  for (const e of [...task.events].sort((a, b) => +a.at - +b.at)) {
    if (e.type === 'blocked' && !open) open = e.at;
    if (e.type === 'unblocked' && open) {
      blocked.push({ start: open, end: e.at });
      open = null;
    }
  }
  if (open) blocked.push({ start: open, end: new Date(Math.max(+open, +end)) });

  return { startedAt, completedAt, stageMs, blocked };
}

const overlapMs = (a: { start: Date; end: Date }, from: Date, to: Date) =>
  Math.max(0, Math.min(+a.end, +to) - Math.max(+a.start, +from));

// ---- Week buckets ----------------------------------------------------------

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d: Date) {
  const x = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(+x - dow * DAY);
}

// ---- Main computation ------------------------------------------------------

export interface PullRequestInput {
  openedAt: Date;
  mergedAt: Date | null;
}

export interface SprintInput {
  id: string;
  name: string;
  completedAt: Date;
  committedPoints: number;
  completedCommittedPoints: number;
  addedPoints: number;
  removedPoints: number;
}

export interface AnalyticsInput {
  tasks: TaskInput[];
  statuses: { name: string; category: Category }[];
  sprints: SprintInput[];
  pullRequests: PullRequestInput[];
  from: Date;
  to: Date;
  definition: Definition;
  now: Date;
}

export function computeAnalytics(input: AnalyticsInput) {
  const { from, to, definition, now } = input;
  const statusMap: StatusMap = new Map(
    input.statuses.map((s) => [s.name, s.category]),
  );

  const rows = input.tasks.map((task) => ({
    task,
    tl: buildTimeline(task, statusMap, now),
  }));

  // Tasks delivered within the range, by the chosen definition of "delivered".
  const delivered = rows
    .map((r) => {
      const at = definition === 'merged' ? r.task.mergedAt : r.tl.completedAt;
      return { ...r, deliveredAt: at };
    })
    .filter(
      (r) => r.deliveredAt && +r.deliveredAt >= +from && +r.deliveredAt <= +to,
    );

  // Cycle time is always measured to completion (Done); lead time follows the
  // selected definition of delivery.
  const cycleRows = rows.filter(
    (r) =>
      r.tl.startedAt &&
      r.tl.completedAt &&
      +r.tl.completedAt >= +from &&
      +r.tl.completedAt <= +to,
  );
  const cycleDays = (r: (typeof cycleRows)[number]) =>
    days(+r.tl.completedAt! - +r.tl.startedAt!);
  const leadDays = (r: (typeof delivered)[number]) =>
    days(+r.deliveredAt! - +r.task.createdAt);

  const completedInRange = rows.filter(
    (r) =>
      r.tl.completedAt &&
      +r.tl.completedAt >= +from &&
      +r.tl.completedAt <= +to,
  );

  // Weekly throughput and cycle-time trend.
  const weeks = new Map<number, { completed: number; cycle: number[] }>();
  for (let w = +weekStart(from); w <= +to; w += 7 * DAY) {
    weeks.set(w, { completed: 0, cycle: [] });
  }
  for (const r of completedInRange) {
    const bucket = weeks.get(+weekStart(r.tl.completedAt!));
    if (!bucket) continue;
    bucket.completed++;
    if (r.tl.startedAt)
      bucket.cycle.push(days(+r.tl.completedAt! - +r.tl.startedAt));
  }
  const weekly = [...weeks.entries()].map(([w, b]) => ({
    weekStart: new Date(w).toISOString().slice(0, 10),
    completed: b.completed,
    medianCycleDays: b.cycle.length ? summarise(b.cycle).median : null,
  }));

  // Where completed work spent its time: the context behind a cycle time.
  const avg = (xs: number[]) =>
    xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  const blockedWithin = (r: (typeof rows)[number]) =>
    days(r.tl.blocked.reduce((n, b) => n + overlapMs(b, from, to), 0));
  const timeInStage = {
    inProgressDays: avg(cycleRows.map((r) => days(r.tl.stageMs.IN_PROGRESS))),
    inReviewDays: avg(cycleRows.map((r) => days(r.tl.stageMs.IN_REVIEW))),
    blockedDays: avg(
      cycleRows.map((r) =>
        days(r.tl.blocked.reduce((n, b) => n + +b.end - +b.start, 0)),
      ),
    ),
  };

  // Blocked work.
  const blockedRows = rows.filter((r) => blockedWithin(r) > 0);
  const blockedDurations = blockedRows.map(blockedWithin);
  const currentlyBlocked = rows
    .filter((r) => r.task.blocked)
    .map((r) => {
      const openInterval = r.tl.blocked.at(-1);
      return {
        taskId: r.task.id,
        key: r.task.key,
        title: r.task.title,
        reason: r.task.blockedReason,
        days: openInterval ? round(days(+now - +openInterval.start)) : 0,
      };
    })
    .sort((a, b) => b.days - a.days);

  // Work in progress right now.
  const byStatus = new Map<
    string,
    { name: string; category: Category; count: number }
  >();
  for (const s of input.statuses) byStatus.set(s.name, { ...s, count: 0 });
  let wip = 0;
  for (const r of rows) {
    const c = r.task.currentCategory ?? statusMap.get(r.task.currentStatus);
    const entry = byStatus.get(r.task.currentStatus);
    if (entry) entry.count++;
    if (c === 'IN_PROGRESS' || c === 'IN_REVIEW') wip++;
  }

  // GitHub activity.
  const opened = input.pullRequests.filter(
    (p) => +p.openedAt >= +from && +p.openedAt <= +to,
  );
  const mergedPrs = input.pullRequests.filter(
    (p) => p.mergedAt && +p.mergedAt >= +from && +p.mergedAt <= +to,
  );
  const hoursToMerge = mergedPrs.map(
    (p) => (+p.mergedAt! - +p.openedAt) / 3_600_000,
  );

  const cycle = summarise(cycleRows.map(cycleDays));
  const lead = summarise(delivered.map(leadDays));

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    definition,
    cycleTime: { ...cycle, unit: 'days', timeInStage },
    leadTime: { ...lead, unit: 'days', definition },
    weekly,
    sprints: input.sprints
      .filter((s) => +s.completedAt >= +from && +s.completedAt <= +to)
      .sort((a, b) => +a.completedAt - +b.completedAt)
      .map((s) => ({
        id: s.id,
        name: s.name,
        completedAt: s.completedAt.toISOString(),
        committedPoints: s.committedPoints,
        completedPoints: s.completedCommittedPoints,
        addedPoints: s.addedPoints,
        removedPoints: s.removedPoints,
        completionRate: s.committedPoints
          ? Math.round((s.completedCommittedPoints / s.committedPoints) * 100)
          : null,
      })),
    wip: {
      total: wip,
      byStatus: [...byStatus.values()],
      blockedNow: currentlyBlocked.length,
    },
    blocked: {
      tasks: blockedRows.length,
      totalDays: round(blockedDurations.reduce((a, b) => a + b, 0)),
      averageDays: blockedDurations.length
        ? round(
            blockedDurations.reduce((a, b) => a + b, 0) /
              blockedDurations.length,
          )
        : null,
      current: currentlyBlocked,
    },
    github: {
      opened: opened.length,
      merged: mergedPrs.length,
      medianHoursToMerge: hoursToMerge.length
        ? summarise(hoursToMerge).median
        : null,
      lowSample: mergedPrs.length < MIN_SAMPLE,
    },
    // The events behind the numbers, so any metric can be investigated.
    completedTasks: completedInRange
      .map((r) => ({
        taskId: r.task.id,
        key: r.task.key,
        title: r.task.title,
        startedAt: r.tl.startedAt?.toISOString() ?? null,
        completedAt: r.tl.completedAt!.toISOString(),
        cycleDays: r.tl.startedAt
          ? round(days(+r.tl.completedAt! - +r.tl.startedAt))
          : null,
        leadDays: round(days(+r.tl.completedAt! - +r.task.createdAt)),
        blockedDays: round(blockedWithin(r)),
      }))
      .sort((a, b) => (b.cycleDays ?? -1) - (a.cycleDays ?? -1)),
  };
}
