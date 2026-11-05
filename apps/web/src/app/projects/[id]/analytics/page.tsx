"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "@/components/auth-provider";
import { RequireAuth } from "@/components/require-auth";
import type { Analytics } from "@/lib/analytics";

export default function AnalyticsPage() {
  return (
    <RequireAuth>
      <AnalyticsView />
    </RequireAuth>
  );
}

const RANGES = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 180 days", days: 180 },
];

const fmtDays = (n: number | null) => (n === null ? "–" : `${n}d`);
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

function AnalyticsView() {
  const { id } = useParams<{ id: string }>();
  const { request } = useAuth();
  const [rangeDays, setRangeDays] = useState(90);
  const [definition, setDefinition] = useState<"done" | "merged">("done");
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const to = new Date();
    const from = new Date(+to - rangeDays * 86_400_000);
    const qs = new URLSearchParams({
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      definition,
    });
    let active = true;
    request<Analytics>(`/projects/${id}/analytics?${qs}`)
      .then((d) => {
        if (!active) return;
        setError(null);
        setData(d);
      })
      .catch(
        (e) =>
          active && setError(e instanceof Error ? e.message : "Failed to load"),
      );
    return () => {
      active = false;
    };
  }, [id, request, rangeDays, definition]);

  if (!data)
    return error ? <main className="p-8 text-muted">{error}</main> : null;

  const { cycleTime, leadTime, wip, blocked } = data;
  const latestSprint = data.sprints.at(-1);

  return (
    <main className="mx-auto w-full max-w-5xl p-6 sm:p-8">
      <Link
        href={`/projects/${id}`}
        className="text-sm text-muted hover:text-foreground"
      >
        ← Board
      </Link>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {data.project.name}{" "}
            <span className="text-muted">· Delivery analytics</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {shortDate(data.range.from)} – {shortDate(data.range.to)} ·
            team-level workflow metrics, not individual performance
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <select
            aria-label="Date range"
            value={rangeDays}
            onChange={(e) => setRangeDays(Number(e.target.value))}
            className="h-8 rounded border border-border bg-background px-2 text-sm"
          >
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Lead time delivery definition"
            value={definition}
            onChange={(e) => setDefinition(e.target.value as "done" | "merged")}
            className="h-8 rounded border border-border bg-background px-2 text-sm"
          >
            <option value="done">Lead time to: Done</option>
            <option value="merged">Lead time to: PR merged</option>
          </select>
        </div>
      </div>

      {/* Headline figures */}
      <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Cycle time (median)"
          value={fmtDays(cycleTime.median)}
          hint={sampleHint(
            cycleTime.n,
            cycleTime.lowSample,
            `p85 ${fmtDays(cycleTime.p85)}`,
          )}
          warn={cycleTime.lowSample && cycleTime.n > 0}
        />
        <Tile
          label={`Lead time to ${leadTime.definition === "merged" ? "merge" : "Done"} (median)`}
          value={fmtDays(leadTime.median)}
          hint={sampleHint(
            leadTime.n,
            leadTime.lowSample,
            `p85 ${fmtDays(leadTime.p85)}`,
          )}
          warn={leadTime.lowSample && leadTime.n > 0}
        />
        <Tile
          label="Work in progress"
          value={String(wip.total)}
          hint={`${wip.blockedNow} blocked right now`}
          warn={wip.blockedNow > 0}
        />
        <Tile
          label="Latest sprint completion"
          value={
            latestSprint?.completionRate == null
              ? "–"
              : `${latestSprint.completionRate}%`
          }
          hint={
            latestSprint ? latestSprint.name : "No completed sprints in range"
          }
        />
      </dl>
      {leadTime.definition === "merged" && (
        <p className="mt-2 text-xs text-muted">
          Lead time to merge only includes tasks with a merged pull request, and
          can’t be compared with reports that use “Done”. Cycle time always ends
          at Done.
        </p>
      )}

      {/* Where the time goes: the context behind cycle time */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">
          Where completed work spent its time
        </h2>
        <p className="mt-1 text-sm text-muted">
          Average per completed task. If cycle time rises, this shows whether
          review time, blocked time or active work grew.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Stage
            label="In progress"
            value={cycleTime.timeInStage.inProgressDays}
          />
          <Stage label="In review" value={cycleTime.timeInStage.inReviewDays} />
          <Stage label="Blocked" value={cycleTime.timeInStage.blockedDays} />
        </div>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Tasks completed per week"
          caption="Count of tasks reaching Done, by week starting Monday."
          rows={data.weekly.map((w) => ({
            Week: shortDate(w.weekStart),
            Completed: w.completed,
          }))}
        >
          <BarChart
            data={data.weekly}
            margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
          >
            <Grid />
            <XAxis dataKey="weekStart" tickFormatter={shortDate} {...axis} />
            <YAxis allowDecimals={false} {...axis} />
            <Tooltip
              content={
                <Tip
                  unit="tasks"
                  labelFormat={(l) => `Week of ${shortDate(l)}`}
                />
              }
              cursor={false}
            />
            <Bar
              dataKey="completed"
              name="Completed"
              fill="var(--chart-2)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ChartCard>

        <ChartCard
          title="Median cycle time by week"
          caption="Days from first active state to Done, for tasks completed that week. Gaps mean nothing finished."
          rows={data.weekly.map((w) => ({
            Week: shortDate(w.weekStart),
            "Median days": w.medianCycleDays ?? "–",
          }))}
        >
          <LineChart
            data={data.weekly}
            margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
          >
            <Grid />
            <XAxis dataKey="weekStart" tickFormatter={shortDate} {...axis} />
            <YAxis {...axis} />
            <Tooltip
              content={
                <Tip
                  unit="days"
                  labelFormat={(l) => `Week of ${shortDate(l)}`}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="medianCycleDays"
              name="Median cycle time"
              stroke="var(--chart-2)"
              strokeWidth={2}
              connectNulls
              dot={{
                r: 4,
                fill: "var(--chart-2)",
                stroke: "var(--surface-1)",
                strokeWidth: 2,
              }}
              activeDot={{
                r: 5,
                fill: "var(--chart-2)",
                stroke: "var(--surface-1)",
                strokeWidth: 2,
              }}
            />
          </LineChart>
        </ChartCard>

        <ChartCard
          title="Sprint commitment vs completion"
          caption="Story points. Completed counts only work that was committed when the sprint started; scope added later is shown in the table."
          legend={[
            { label: "Committed", color: "var(--chart-1)" },
            { label: "Completed", color: "var(--chart-2)" },
          ]}
          empty={
            data.sprints.length === 0
              ? "No completed sprints in this range."
              : undefined
          }
          rows={data.sprints.map((s) => ({
            Sprint: s.name,
            Committed: s.committedPoints,
            Completed: s.completedPoints,
            "Completion rate":
              s.completionRate === null ? "–" : `${s.completionRate}%`,
            Added: s.addedPoints,
            Removed: s.removedPoints,
          }))}
        >
          <BarChart
            data={data.sprints}
            barGap={2}
            margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
          >
            <Grid />
            <XAxis dataKey="name" {...axis} />
            <YAxis allowDecimals={false} {...axis} />
            <Tooltip content={<Tip unit="pts" />} cursor={false} />
            <Bar
              dataKey="committedPoints"
              name="Committed"
              fill="var(--chart-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
            <Bar
              dataKey="completedPoints"
              name="Completed"
              fill="var(--chart-2)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ChartCard>

        <ChartCard
          title="Work in progress by stage"
          caption="Tasks currently in each workflow stage."
          rows={wip.byStatus.map((s) => ({ Stage: s.name, Tasks: s.count }))}
        >
          <BarChart
            data={wip.byStatus}
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis type="number" allowDecimals={false} {...axis} />
            <YAxis type="category" dataKey="name" width={84} {...axis} />
            <Tooltip content={<Tip unit="tasks" />} cursor={false} />
            <Bar
              dataKey="count"
              name="Tasks"
              fill="var(--chart-2)"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
            />
          </BarChart>
        </ChartCard>
      </div>

      {/* Blocked work */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">Blocked work</h2>
        <p className="mt-1 text-sm text-muted">
          {blocked.tasks === 0
            ? "No tasks were blocked in this range."
            : `${blocked.tasks} task${blocked.tasks === 1 ? " was" : "s were"} blocked for ${blocked.totalDays} days in total (average ${fmtDays(blocked.averageDays)} each).`}
        </p>
        {blocked.current.length > 0 && (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-1">
            {blocked.current.map((b) => (
              <li key={b.taskId}>
                <Link
                  href={`/tasks/${b.taskId}`}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2"
                >
                  <span className="w-16 shrink-0 font-mono text-[11px] text-muted">
                    {b.key}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{b.title}</span>
                  <span className="hidden truncate text-xs text-muted sm:inline">
                    {b.reason ?? "No reason given"}
                  </span>
                  <span className="rounded border border-critical/30 bg-critical/10 px-1.5 py-0.5 text-[10px] font-medium text-critical">
                    Blocked {b.days}d
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* GitHub activity */}
      {data.hasRepository && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-muted">GitHub activity</h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stage label="PRs opened" value={data.github.opened} unit="" />
            <Stage label="PRs merged" value={data.github.merged} unit="" />
            <Stage
              label="Median time to merge"
              value={data.github.medianHoursToMerge}
              unit="h"
              note={
                data.github.lowSample && data.github.merged > 0
                  ? "Small sample"
                  : undefined
              }
            />
          </div>
        </section>
      )}

      {/* The events behind the numbers */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">
          Completed tasks behind these metrics
        </h2>
        <p className="mt-1 text-sm text-muted">
          Longest cycle times first. Open a task to see its full history.
        </p>
        {data.completedTasks.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-border p-6 text-center text-sm text-muted">
            No tasks were completed in this range.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">Task</th>
                  <th className="px-4 py-2 text-right font-medium">Cycle</th>
                  <th className="px-4 py-2 text-right font-medium">Lead</th>
                  <th className="px-4 py-2 text-right font-medium">Blocked</th>
                  <th className="px-4 py-2 text-right font-medium">
                    Completed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.completedTasks.map((t) => (
                  <tr key={t.taskId} className="hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <Link href={`/tasks/${t.taskId}`} className="flex gap-3">
                        <span className="w-16 shrink-0 font-mono text-[11px] text-muted">
                          {t.key}
                        </span>
                        <span className="truncate">{t.title}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtDays(t.cycleDays)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtDays(t.leadDays)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtDays(t.blockedDays)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">
                      {shortDate(t.completedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-8 text-xs text-muted">
        Metrics are calculated from recorded task history, so edits made later
        don’t rewrite the past. Cycle time runs from the first time a task
        enters an active state (In Progress or In Review) to Done; tasks that
        skip straight to Done have no cycle time. Reopened tasks aren’t counted
        until finished again. Deleted tasks are not included.
      </p>
    </main>
  );
}

// ---- Pieces ----------------------------------------------------------------

const axis = {
  stroke: "var(--chart-axis)",
  tick: { fill: "var(--muted)", fontSize: 11 },
  tickLine: false as const,
  axisLine: { stroke: "var(--chart-grid)" },
};

function Grid() {
  return <CartesianGrid vertical={false} stroke="var(--chart-grid)" />;
}

function sampleHint(n: number, low: boolean, extra: string) {
  if (n === 0) return "No data in this range";
  return `${n} task${n === 1 ? "" : "s"}${low ? " · small sample, read with caution" : ""} · ${extra}`;
}

function Tile({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-3xl font-semibold tracking-tight">{value}</dd>
      <p className={`mt-1 text-xs ${warn ? "text-warning" : "text-muted"}`}>
        {hint}
      </p>
    </div>
  );
}

function Stage({
  label,
  value,
  unit = "d",
  note,
}: {
  label: string;
  value: number | null;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tracking-tight">
        {value === null ? "–" : `${value}${unit}`}
      </p>
      {note && <p className="text-xs text-warning">{note}</p>}
    </div>
  );
}

function ChartCard({
  title,
  caption,
  legend,
  empty,
  rows,
  children,
}: {
  title: string;
  caption: string;
  legend?: { label: string; color: string }[];
  empty?: string;
  rows: Record<string, string | number>[];
  children: React.ReactElement;
}) {
  const [table, setTable] = useState(false);
  const columns = useMemo(() => (rows[0] ? Object.keys(rows[0]) : []), [rows]);
  return (
    <section className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-start gap-2">
        <h2 className="flex-1 text-sm font-medium">{title}</h2>
        {!empty && (
          <button
            onClick={() => setTable((t) => !t)}
            aria-pressed={table}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-surface-2"
          >
            {table ? "Show chart" : "Show table"}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{caption}</p>
      {legend && (
        <ul className="mt-3 flex gap-4 text-xs text-muted">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm"
                style={{ background: l.color }}
                aria-hidden
              />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 h-56" role="img" aria-label={`${title} chart`}>
        {empty ? (
          <p className="flex h-full items-center justify-center text-sm text-muted">
            {empty}
          </p>
        ) : table ? (
          <div className="h-full overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  {columns.map((c) => (
                    <th key={c} className="py-1 pr-3 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c} className="py-1 pr-3 tabular-nums">
                        {r[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

interface TipProps {
  active?: boolean;
  payload?: {
    name?: string;
    value?: number | string;
    color?: string;
    fill?: string;
    stroke?: string;
  }[];
  label?: string;
  unit: string;
  labelFormat?: (label: string) => string;
}

function Tip({ active, payload, label, unit, labelFormat }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg">
      {label !== undefined && (
        <p className="mb-1 font-medium">
          {labelFormat ? labelFormat(String(label)) : label}
        </p>
      )}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-muted">
          <span
            className="size-2 rounded-sm"
            style={{ background: p.fill ?? p.stroke ?? p.color }}
            aria-hidden
          />
          {p.name}:{" "}
          <span className="text-foreground">
            {p.value ?? "–"} {unit}
          </span>
        </p>
      ))}
    </div>
  );
}
