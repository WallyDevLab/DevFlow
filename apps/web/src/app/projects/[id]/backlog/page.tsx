"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { LabelChips } from "@/components/labels";
import { RequireAuth } from "@/components/require-auth";
import {
  formatDate,
  rankAt,
  type BacklogData,
  type PlanSprint,
  type PlanTask,
} from "@/lib/sprints";
import { priorityLabel, priorityStyle } from "@/lib/tasks";

const BACKLOG_ID = "backlog";

export default function BacklogPage() {
  return (
    <RequireAuth>
      <BacklogView />
    </RequireAuth>
  );
}

function BacklogView() {
  const { id } = useParams<{ id: string }>();
  const { request } = useAuth();
  const [data, setData] = useState<BacklogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<PlanTask | null>(null);
  const [completing, setCompleting] = useState<PlanSprint | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const refresh = useCallback(
    () =>
      request<BacklogData>(`/projects/${id}/backlog`)
        .then(setData)
        .catch((e) =>
          setError(e instanceof Error ? e.message : "Failed to load"),
        ),
    [id, request],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
    await refresh();
  }

  // Lists in display order: each sprint, then the backlog.
  const lists = data
    ? [
        ...data.sprints.map((s) => ({ id: s.id, tasks: s.tasks })),
        { id: BACKLOG_ID, tasks: data.backlog },
      ]
    : [];

  function onDragStart(e: DragStartEvent) {
    setActive(
      lists.flatMap((l) => l.tasks).find((t) => t.id === e.active.id) ?? null,
    );
  }

  async function onDragEnd(e: DragEndEvent) {
    setActive(null);
    if (!data || !e.over) return;
    const taskId = String(e.active.id);
    const overId = String(e.over.id);
    const from = lists.find((l) => l.tasks.some((t) => t.id === taskId));
    const target =
      lists.find((l) => l.id === overId) ??
      lists.find((l) => l.tasks.some((t) => t.id === overId));
    if (!from || !target) return;

    const others = target.tasks.filter((t) => t.id !== taskId);
    const overIndex = others.findIndex((t) => t.id === overId);
    const index = overIndex === -1 ? others.length : overIndex;
    const backlogRank = rankAt(
      others.map((t) => t.backlogRank),
      index,
    );

    const body: Record<string, unknown> = { backlogRank };
    if (target.id !== from.id) {
      body.sprintId = target.id === BACKLOG_ID ? null : target.id;
    }
    await act(() => request(`/tasks/${taskId}`, { method: "PATCH", body }));
  }

  if (!data)
    return error ? <main className="p-8 text-muted">{error}</main> : null;
  const { permissions } = data;
  const planning = data.sprints.filter((s) => s.status === "PLANNING");

  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <div className="flex items-center gap-4 text-sm">
        <Link
          href={`/projects/${id}`}
          className="text-muted hover:text-foreground"
        >
          ← Board
        </Link>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {data.project.name}{" "}
        <span className="text-muted">· Backlog &amp; sprints</span>
      </h1>
      {!permissions.planBacklog && (
        <p className="mt-1 text-sm text-muted">
          You have read-only access to planning.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
        >
          {error}
        </p>
      )}

      {permissions.manageSprints && (
        <NewSprint
          onCreate={(body) =>
            act(() => request(`/projects/${id}/sprints`, { body }))
          }
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}
      >
        <div className="mt-6 flex flex-col gap-5">
          {data.sprints.map((s) => (
            <Section
              key={s.id}
              id={s.id}
              title={s.name}
              badge={s.status === "ACTIVE" ? "Active" : "Planned"}
              meta={`${formatDate(s.startDate)} – ${formatDate(s.endDate)} · ${s.points} pts`}
              goal={s.goal}
              tasks={s.tasks}
              canPlan={permissions.planBacklog}
              actions={
                permissions.manageSprints && (
                  <>
                    {s.status === "PLANNING" && (
                      <button
                        onClick={() =>
                          act(() =>
                            request(`/sprints/${s.id}/start`, {
                              method: "POST",
                            }),
                          )
                        }
                        className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                      >
                        Start sprint
                      </button>
                    )}
                    {s.status === "ACTIVE" && (
                      <button
                        onClick={() => setCompleting(s)}
                        className="rounded border border-border px-3 py-1 text-xs hover:bg-surface-2"
                      >
                        Complete sprint
                      </button>
                    )}
                  </>
                )
              }
              footer={
                s.status === "ACTIVE" && (
                  <Link
                    href={`/sprints/${s.id}/report`}
                    className="text-xs text-primary hover:underline"
                  >
                    Live report
                  </Link>
                )
              }
            />
          ))}
          <Section
            id={BACKLOG_ID}
            title="Backlog"
            meta={`${data.backlog.length} tasks`}
            tasks={data.backlog}
            canPlan={permissions.planBacklog}
          />
        </div>
        <DragOverlay>{active && <Row task={active} dragging />}</DragOverlay>
      </DndContext>

      {data.completed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-muted">Completed sprints</h2>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-1">
            {data.completed.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/sprints/${c.id}/report`}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-surface-2"
                >
                  <span>{c.name}</span>
                  <span className="text-xs text-muted">View report →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {completing && (
        <CompleteDialog
          sprint={completing}
          targets={planning}
          onCancel={() => setCompleting(null)}
          onConfirm={async (incompleteTo) => {
            const sprintId = completing.id;
            setCompleting(null);
            await act(() =>
              request(`/sprints/${sprintId}/complete`, {
                body: { incompleteTo },
              }),
            );
          }}
        />
      )}
    </main>
  );
}

function NewSprint({
  onCreate,
}: {
  onCreate: (body: Record<string, string>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-5 rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
      >
        + Create sprint
      </button>
    );
  }
  const input =
    "h-9 rounded border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none";
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await onCreate({
          name: String(f.get("name")),
          goal: String(f.get("goal")),
          startDate: String(f.get("startDate")),
          endDate: String(f.get("endDate")),
        });
        setOpen(false);
      }}
      className="mt-5 grid gap-3 rounded-lg border border-border bg-surface-1 p-4 sm:grid-cols-2"
    >
      <input
        name="name"
        required
        maxLength={80}
        placeholder="Sprint name"
        aria-label="Sprint name"
        className={input}
      />
      <input
        name="goal"
        maxLength={500}
        placeholder="Sprint goal (optional)"
        aria-label="Sprint goal"
        className={input}
      />
      <label className="flex flex-col gap-1 text-xs text-muted">
        Start
        <input name="startDate" type="date" required className={input} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        End
        <input name="endDate" type="date" required className={input} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button className="h-9 rounded bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
          Create sprint
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-9 rounded border border-border px-4 text-sm hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Section({
  id,
  title,
  badge,
  meta,
  goal,
  tasks,
  canPlan,
  actions,
  footer,
}: {
  id: string;
  title: string;
  badge?: string;
  meta: string;
  goal?: string;
  tasks: PlanTask[];
  canPlan: boolean;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={`rounded-lg border bg-surface-1 ${isOver ? "border-primary" : "border-border"}`}
    >
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <h2 className="font-medium">{title}</h2>
        {badge && (
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
              badge === "Active"
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted"
            }`}
          >
            {badge}
          </span>
        )}
        <span className="text-xs text-muted">{meta}</span>
        <div className="ml-auto flex items-center gap-3">
          {footer}
          {actions}
        </div>
      </header>
      {goal && <p className="px-4 pb-2 text-sm text-muted">Goal: {goal}</p>}
      <div className="flex min-h-10 flex-col gap-px border-t border-border">
        {tasks.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted">
            {canPlan ? "Drag tasks here." : "No tasks."}
          </p>
        )}
        {tasks.map((t) => (
          <DraggableRow key={t.id} task={t} canPlan={canPlan} />
        ))}
      </div>
    </section>
  );
}

function DraggableRow({ task, canPlan }: { task: PlanTask; canPlan: boolean }) {
  const drag = useDraggable({ id: task.id, disabled: !canPlan });
  const { setNodeRef: setDropRef } = useDroppable({ id: task.id });
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        setDropRef(el);
      }}
      {...drag.listeners}
      {...drag.attributes}
      className={drag.isDragging ? "opacity-40" : undefined}
    >
      <Link href={`/tasks/${task.id}`} draggable={false}>
        <Row task={task} />
      </Link>
    </div>
  );
}

function Row({ task, dragging }: { task: PlanTask; dragging?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 bg-surface-1 px-4 py-2 text-sm hover:bg-surface-2 ${
        dragging ? "rounded border border-border shadow-lg" : ""
      }`}
    >
      <span className="w-16 shrink-0 font-mono text-[11px] text-muted">
        {task.key}
      </span>
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      <span className="hidden md:block">
        <LabelChips labels={task.labels} max={2} />
      </span>
      {task.blocked && (
        <span className="rounded border border-critical/30 bg-critical/10 px-1 text-[10px] font-medium text-critical">
          Blocked
        </span>
      )}
      <span className="hidden text-xs text-muted sm:inline">
        {task.status.name}
      </span>
      <span
        className={`rounded border px-1.5 py-0.5 text-[10px] ${priorityStyle[task.priority]}`}
      >
        {priorityLabel(task.priority)}
      </span>
      <span className="w-12 text-right font-mono text-[11px] text-muted">
        {task.storyPoints ?? "–"} pts
      </span>
      <span
        title={task.assignee?.name ?? "Unassigned"}
        className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-medium text-primary"
      >
        {task.assignee ? task.assignee.name.charAt(0).toUpperCase() : ""}
      </span>
    </div>
  );
}

function CompleteDialog({
  sprint,
  targets,
  onCancel,
  onConfirm,
}: {
  sprint: PlanSprint;
  targets: PlanSprint[];
  onCancel: () => void;
  onConfirm: (incompleteTo: string) => void;
}) {
  const open = sprint.tasks.filter((t) => t.status.category !== "DONE");
  const [dest, setDest] = useState("BACKLOG");
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Complete sprint"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-1 p-6">
        <h2 className="text-lg font-semibold">Complete {sprint.name}?</h2>
        <p className="mt-2 text-sm text-muted">
          {sprint.tasks.length - open.length} of {sprint.tasks.length} tasks are
          done. Completed sprints can’t be reopened.
        </p>
        {open.length > 0 && (
          <label className="mt-4 flex flex-col gap-1.5 text-sm font-medium">
            Move {open.length} unfinished task{open.length === 1 ? "" : "s"} to
            <select
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              className="h-9 rounded border border-border bg-background px-2 text-sm"
            >
              <option value="BACKLOG">Backlog</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="h-9 rounded border border-border px-4 text-sm hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(dest)}
            className="h-9 rounded bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Complete sprint
          </button>
        </div>
      </div>
    </div>
  );
}
