"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { RequireAuth } from "@/components/require-auth";
import { formatDate, type ReportItem, type SprintReport } from "@/lib/sprints";

export default function ReportPage() {
  return (
    <RequireAuth>
      <Report />
    </RequireAuth>
  );
}

function Report() {
  const { id } = useParams<{ id: string }>();
  const { request } = useAuth();
  const [report, setReport] = useState<SprintReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<SprintReport>(`/sprints/${id}/report`)
      .then(setReport)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [id, request]);

  if (!report)
    return error ? <main className="p-8 text-muted">{error}</main> : null;
  const { sprint } = report;

  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <Link
        href={`/projects/${report.project.id}/backlog`}
        className="text-sm text-muted hover:text-foreground"
      >
        ← Backlog &amp; sprints
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {sprint.name}{" "}
        <span className="text-muted">
          · {report.final ? "Sprint report" : "Live report"}
        </span>
      </h1>
      <p className="mt-1 text-sm text-muted">
        {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
        {sprint.goal && ` · Goal: ${sprint.goal}`}
      </p>
      {!report.final && (
        <p className="mt-3 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          This sprint is still running, so these numbers can change.
        </p>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Completion rate"
          value={
            report.completionRate === null ? "–" : `${report.completionRate}%`
          }
          hint={`${report.completedCommittedPoints} of ${report.committedPoints} committed pts`}
        />
        <Stat
          label="Committed"
          value={`${report.committedPoints} pts`}
          hint="At sprint start"
        />
        <Stat
          label="Added mid-sprint"
          value={`${report.addedPoints} pts`}
          hint="Scope added"
        />
        <Stat
          label="Removed"
          value={`${report.removedPoints} pts`}
          hint="Scope removed"
        />
      </dl>
      <p className="mt-2 text-xs text-muted">
        Completion rate = completed committed points ÷ committed points. Work
        added after the sprint started doesn’t count towards or against it.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <List title="Original commitment" items={report.committed} />
        <List title="Added during the sprint" items={report.added} />
        <List title="Removed during the sprint" items={report.removed} />
        <List
          title={`Completed (${report.completedPoints} pts)`}
          items={report.completed}
        />
        <List
          title={
            report.final ? "Not completed (moved on)" : "Not completed yet"
          }
          items={report.incomplete}
        />
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function List({ title, items }: { title: string; items: ReportItem[] }) {
  return (
    <section>
      <h2 className="text-sm font-medium text-muted">
        {title} <span className="text-muted/60">· {items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted/70">None</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface-1">
          {items.map((i) => (
            <li
              key={i.taskId}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <span className="w-14 shrink-0 font-mono text-[11px] text-muted">
                {i.key}
              </span>
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              <span className="font-mono text-[11px] text-muted">
                {i.points} pts
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
