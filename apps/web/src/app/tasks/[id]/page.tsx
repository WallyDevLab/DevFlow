"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Comments } from "@/components/comments";
import { LabelPicker, type Label } from "@/components/labels";
import { RequireAuth } from "@/components/require-auth";
import { describeActivity } from "@/lib/activity";
import { safeHttpsUrl } from "@/lib/url";
import { PRIORITIES, priorityLabel, type Priority } from "@/lib/tasks";

interface Task {
  id: string;
  key: string;
  projectId: string;
  projectName: string;
  workspaceId: string;
  title: string;
  description: string;
  status: { id: string; name: string };
  statuses: { id: string; name: string }[];
  priority: Priority;
  assignee: { id: string; name: string } | null;
  reporter: { id: string; name: string };
  storyPoints: number | null;
  dueDate: string | null;
  blocked: boolean;
  blockedReason: string | null;
  createdAt: string;
  labels: Label[];
  canEdit: boolean;
  pullRequests: {
    id: string;
    repository: string;
    number: number;
    title: string;
    url: string;
    state: string;
    draft: boolean;
    merged: boolean;
    branch: string;
    author: string;
    reviewState: string | null;
    checksState: string | null;
  }[];
  activity: {
    id: string;
    type: string;
    data: Record<string, string | string[] | null> | null;
    actor: string;
    createdAt: string;
  }[];
}
interface Member {
  userId: string;
  name: string;
}

const field =
  "h-8 w-full rounded border border-border bg-background px-2 text-sm focus:border-primary focus:outline-none disabled:opacity-70";

export default function TaskPage() {
  return (
    <RequireAuth>
      <TaskView />
    </RequireAuth>
  );
}

function describe(a: Task["activity"][number], names: Map<string, string>) {
  return describeActivity(a.type, a.data, names);
}

function TaskView() {
  const { id } = useParams<{ id: string }>();
  const { request } = useAuth();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");

  const refresh = useCallback(
    () =>
      request<Task>(`/tasks/${id}`)
        .then(async (t) => {
          setTask(t);
          setTitle(t.title);
          setDescription(t.description);
          setReason(t.blockedReason ?? "");
          setMembers(
            await request<Member[]>(`/workspaces/${t.workspaceId}/members`),
          );
        })
        .catch((e) =>
          setError(e instanceof Error ? e.message : "Failed to load"),
        ),
    [id, request],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(body: Record<string, unknown>) {
    setError(null);
    try {
      await request(`/tasks/${id}`, { method: "PATCH", body });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    }
  }

  async function remove() {
    if (!confirm(`Delete ${task?.key}? This can't be undone.`)) return;
    try {
      await request(`/tasks/${id}`, { method: "DELETE" });
      router.replace(`/projects/${task?.projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete");
    }
  }

  if (!task)
    return error ? <main className="p-8 text-muted">{error}</main> : null;
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const ro = !task.canEdit;

  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <Link
        href={`/projects/${task.projectId}`}
        className="text-sm text-muted hover:text-foreground"
      >
        ← {task.projectName}
      </Link>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
          {task.key}
        </span>
        {task.blocked && (
          <span className="rounded border border-critical/30 bg-critical/10 px-1.5 py-0.5 text-[11px] font-medium text-critical">
            Blocked
          </span>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
        >
          {error}
        </p>
      )}

      <div className="mt-3 grid gap-8 md:grid-cols-[1fr_16rem]">
        <div>
          <input
            value={title}
            disabled={ro}
            maxLength={200}
            aria-label="Title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() =>
              title.trim() && title !== task.title && save({ title })
            }
            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-2xl font-semibold tracking-tight hover:border-border focus:border-primary focus:outline-none"
          />
          <h2 className="mt-6 text-sm font-medium text-muted">Description</h2>
          <textarea
            value={description}
            disabled={ro}
            rows={6}
            aria-label="Description"
            placeholder="Add a description…"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() =>
              description !== task.description && save({ description })
            }
            className="mt-2 w-full rounded border border-border bg-background p-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none"
          />

          <Development prs={task.pullRequests} />

          <Comments
            taskId={task.id}
            canComment={task.canEdit}
            members={members}
          />

          <h2 className="mt-8 text-sm font-medium text-muted">Activity</h2>
          <ul className="mt-3 flex flex-col gap-2.5">
            {task.activity.map((a) => (
              <li key={a.id} className="text-sm">
                <span className="font-medium">{a.actor}</span>{" "}
                <span className="text-muted">{describe(a, names)}</span>
                <span className="ml-2 text-xs text-muted/70">
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Labels
            <LabelPicker
              projectId={task.projectId}
              selected={task.labels}
              disabled={ro}
              onChange={(ids) => save({ labelIds: ids })}
            />
          </div>
          <Labelled label="Status">
            <select
              disabled={ro}
              value={task.status.id}
              onChange={(e) => save({ statusId: e.target.value })}
              className={field}
            >
              {task.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Priority">
            <select
              disabled={ro}
              value={task.priority}
              onChange={(e) => save({ priority: e.target.value })}
              className={field}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel(p)}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Assignee">
            <select
              disabled={ro}
              value={task.assignee?.id ?? ""}
              onChange={(e) => save({ assigneeId: e.target.value || null })}
              className={field}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Story points">
            <input
              type="number"
              min={0}
              max={100}
              disabled={ro}
              defaultValue={task.storyPoints ?? ""}
              key={`sp-${task.storyPoints}`}
              onBlur={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                if (v !== task.storyPoints) save({ storyPoints: v });
              }}
              className={field}
            />
          </Labelled>
          <Labelled label="Due date">
            <input
              type="date"
              disabled={ro}
              defaultValue={task.dueDate?.slice(0, 10) ?? ""}
              key={`due-${task.dueDate}`}
              onBlur={(e) => {
                const v = e.target.value || null;
                if (v !== (task.dueDate?.slice(0, 10) ?? null))
                  save({ dueDate: v });
              }}
              className={field}
            />
          </Labelled>

          <div className="rounded border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                disabled={ro}
                checked={task.blocked}
                onChange={(e) =>
                  save({
                    blocked: e.target.checked,
                    blockedReason: e.target.checked ? reason || null : null,
                  })
                }
              />
              Blocked
            </label>
            {task.blocked ? (
              <p className="mt-2 text-xs text-muted">
                {task.blockedReason ?? "No reason given"}
              </p>
            ) : (
              !ro && (
                <input
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (optional)"
                  aria-label="Blocked reason"
                  className={`${field} mt-2`}
                />
              )
            )}
          </div>

          <p className="text-xs text-muted">
            Reported by {task.reporter.name} ·{" "}
            {new Date(task.createdAt).toLocaleDateString()}
          </p>
          {!ro && (
            <button
              onClick={remove}
              className="w-fit text-xs text-critical hover:underline"
            >
              Delete task
            </button>
          )}
        </aside>
      </div>
    </main>
  );
}

function Labelled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
      {label}
      {children}
    </label>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "info" | "muted";
  children: React.ReactNode;
}) {
  const tones = {
    ok: "border-success/30 bg-success/10 text-success",
    warn: "border-warning/30 bg-warning/10 text-warning",
    bad: "border-critical/30 bg-critical/10 text-critical",
    info: "border-branch/30 bg-branch/10 text-branch",
    muted: "border-border text-muted",
  };
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Development({ prs }: { prs: Task["pullRequests"] }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium text-muted">Development</h2>
      {prs.length === 0 ? (
        <p className="mt-2 rounded border border-dashed border-border p-4 text-sm text-muted">
          No pull requests yet. Include this task’s key in a branch name or pull
          request title (e.g.{" "}
          <span className="font-mono">feature/KEY-123-…</span>) to link it.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface-1">
          {prs.map((pr) => (
            <li key={pr.id} className="px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={safeHttpsUrl(pr.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                >
                  #{pr.number} {pr.title}
                </a>
                {pr.merged ? (
                  <Badge tone="info">Merged</Badge>
                ) : pr.state === "closed" ? (
                  <Badge tone="muted">Closed</Badge>
                ) : pr.draft ? (
                  <Badge tone="muted">Draft</Badge>
                ) : (
                  <Badge tone="ok">Open</Badge>
                )}
                {pr.reviewState === "approved" && (
                  <Badge tone="ok">Approved</Badge>
                )}
                {pr.reviewState === "changes_requested" && (
                  <Badge tone="bad">Changes requested</Badge>
                )}
                {pr.reviewState === "review_requested" && (
                  <Badge tone="warn">Review requested</Badge>
                )}
                {pr.checksState === "success" && (
                  <Badge tone="ok">Checks passed</Badge>
                )}
                {pr.checksState === "failure" && (
                  <Badge tone="bad">Checks failed</Badge>
                )}
                {pr.checksState === "pending" && (
                  <Badge tone="warn">Checks running</Badge>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] text-muted">
                {pr.repository} · {pr.branch} · by {pr.author}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
