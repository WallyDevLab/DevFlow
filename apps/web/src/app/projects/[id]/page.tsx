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
import { ColumnSettings } from "@/components/column-settings";
import { LabelChips, LabelManager } from "@/components/labels";
import { RepoLink } from "@/components/repo-link";
import { RequireAuth } from "@/components/require-auth";
import {
  priorityLabel,
  priorityStyle,
  type Board,
  type BoardTask,
} from "@/lib/tasks";

export default function ProjectBoardPage() {
  return (
    <RequireAuth>
      <BoardView />
    </RequireAuth>
  );
}

function BoardView() {
  const { id } = useParams<{ id: string }>();
  const { request } = useAuth();
  const [board, setBoard] = useState<Board | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [repository, setRepository] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<BoardTask | null>(null);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [members, setMembers] = useState<{ userId: string; name: string }[]>(
    [],
  );
  const [canPlan, setCanPlan] = useState(false);
  const [canConfigure, setCanConfigure] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const sensors = useSensors(
    // A small distance so clicking a card still navigates instead of dragging.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const refresh = useCallback(
    () =>
      Promise.all([
        request<Board>(`/projects/${id}/boards`),
        request<{
          workspaceId: string;
          repository: string | null;
          role: string;
        }>(`/projects/${id}`),
      ])
        .then(async ([b, p]) => {
          setBoard(b);
          setCanPlan(
            ["OWNER", "ADMIN", "SCRUM_MASTER", "PRODUCT_OWNER"].includes(
              p.role,
            ),
          );
          setCanConfigure(["OWNER", "ADMIN", "SCRUM_MASTER"].includes(p.role));
          setMembers(await request(`/workspaces/${p.workspaceId}/members`));
          setWorkspaceId(p.workspaceId);
          setRepository(p.repository);
          setCanManage(p.role === "OWNER" || p.role === "ADMIN");
        })
        .catch((e) =>
          setError(e instanceof Error ? e.message : "Failed to load"),
        ),
    [id, request],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function onDragStart(e: DragStartEvent) {
    setActive(
      board?.columns
        .flatMap((c) => c.tasks)
        .find((t) => t.id === e.active.id) ?? null,
    );
  }

  async function onDragEnd(e: DragEndEvent) {
    setActive(null);
    if (!board || !e.over) return;
    const taskId = String(e.active.id);
    const overId = String(e.over.id);

    const from = board.columns.find((c) =>
      c.tasks.some((t) => t.id === taskId),
    );
    const task = from?.tasks.find((t) => t.id === taskId);
    if (!from || !task) return;

    // Dropping on a column appends; dropping on a card inserts before it.
    const targetCol =
      board.columns.find((c) => c.id === overId) ??
      board.columns.find((c) => c.tasks.some((t) => t.id === overId));
    if (!targetCol) return;
    const others = targetCol.tasks.filter((t) => t.id !== taskId);
    const overIndex = others.findIndex((t) => t.id === overId);
    const index = overIndex === -1 ? others.length : overIndex;
    const prev = others[index - 1]?.position;
    const next = others[index]?.position;
    const position =
      prev === undefined && next === undefined
        ? 1000
        : prev === undefined
          ? next! - 1000
          : next === undefined
            ? prev + 1000
            : (prev + next) / 2;
    if (targetCol.id === from.id && task.position === position) return;

    // Optimistic update, rolled back by a refresh if the request fails.
    setBoard({
      ...board,
      columns: board.columns.map((c) => {
        const without = c.tasks.filter((t) => t.id !== taskId);
        if (c.id !== targetCol.id) return { ...c, tasks: without };
        const moved = { ...task, position };
        return {
          ...c,
          tasks: [...without, moved].sort((a, b) => a.position - b.position),
        };
      }),
    });
    // WIP limits warn rather than block.
    if (
      targetCol.id !== from.id &&
      targetCol.wipLimit !== null &&
      others.length + 1 > targetCol.wipLimit
    ) {
      setNotice(
        `${targetCol.name} is over its WIP limit (${others.length + 1} of ${targetCol.wipLimit}).`,
      );
    }
    try {
      await request(`/tasks/${taskId}`, {
        method: "PATCH",
        body: { statusId: targetCol.id, position },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't move task");
      void refresh();
    }
  }

  async function addTask(statusId: string, title: string) {
    setError(null);
    try {
      await request(`/projects/${id}/tasks`, { body: { title, statusId } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create task");
    }
  }

  if (!board) {
    return error ? <main className="p-8 text-muted">{error}</main> : null;
  }

  const archived = board.project.status === "ARCHIVED";
  // Labels in use on this board (the filter only offers labels that exist on tasks).
  const boardLabels = [
    ...new Map(
      board.columns
        .flatMap((c) => c.tasks.flatMap((t) => t.labels))
        .map((l) => [l.id, l]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const q = search.trim().toLowerCase();
  const visible = (t: BoardTask) =>
    (!q ||
      t.title.toLowerCase().includes(q) ||
      t.key.toLowerCase().includes(q)) &&
    (!priority || t.priority === priority) &&
    (!labelFilter || t.labels.some((l) => l.id === labelFilter)) &&
    (!assigneeFilter ||
      (assigneeFilter === "none"
        ? !t.assignee
        : t.assignee?.id === assigneeFilter));

  return (
    <main className="flex min-h-screen flex-col p-6">
      <Link
        href={workspaceId ? `/workspaces/${workspaceId}` : "/dashboard"}
        className="text-sm text-muted hover:text-foreground"
      >
        ← Workspace
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {board.project.name}
        </h1>
        <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
          {board.project.key}
        </span>
        <Link
          href={`/projects/${id}/backlog`}
          className="rounded border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
        >
          Backlog &amp; sprints
        </Link>
        <Link
          href={`/projects/${id}/analytics`}
          className="rounded border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
        >
          Analytics
        </Link>
        <LabelManager projectId={id} canPlan={canPlan} onChanged={refresh} />
        {canConfigure && (
          <button
            onClick={() => setShowColumns(true)}
            className="rounded border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
          >
            Columns
          </button>
        )}
        {workspaceId && (
          <RepoLink
            projectId={id}
            workspaceId={workspaceId}
            repository={repository}
            canManage={canManage}
            onChange={refresh}
          />
        )}
        {archived && (
          <span className="text-xs text-warning">Archived — read only</span>
        )}
        <div className="ml-auto flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
            className="h-8 w-44 rounded border border-border bg-background px-3 text-sm placeholder:text-muted focus:border-primary focus:outline-none"
          />
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            aria-label="Filter by priority"
            className="h-8 rounded border border-border bg-background px-2 text-sm"
          >
            <option value="">All priorities</option>
            {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => (
              <option key={p} value={p}>
                {p.charAt(0) + p.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          <select
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value)}
            aria-label="Filter by label"
            className="h-8 rounded border border-border bg-background px-2 text-sm"
          >
            <option value="">All labels</option>
            {boardLabels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            aria-label="Filter by assignee"
            className="h-8 rounded border border-border bg-background px-2 text-sm"
          >
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className="mt-3 flex items-center gap-3 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          {notice}
          <button
            onClick={() => setNotice(null)}
            className="ml-auto text-xs underline"
          >
            Dismiss
          </button>
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
        >
          {error}
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}
      >
        <div className="mt-5 flex flex-1 items-start gap-3 overflow-x-auto pb-4">
          {board.columns.map((col) => (
            <Column
              key={col.id}
              id={col.id}
              name={col.name}
              count={col.tasks.filter(visible).length}
              total={col.tasks.length}
              wipLimit={col.wipLimit}
              onAdd={archived ? undefined : (title) => addTask(col.id, title)}
            >
              {col.tasks.filter(visible).map((t) => (
                <Card key={t.id} task={t} />
              ))}
            </Column>
          ))}
        </div>
        <DragOverlay>
          {active && <CardBody task={active} dragging />}
        </DragOverlay>
      </DndContext>

      {showColumns && (
        <ColumnSettings
          projectId={id}
          columns={board.columns}
          onChanged={refresh}
          onClose={() => setShowColumns(false)}
        />
      )}
    </main>
  );
}

function Column({
  id,
  name,
  count,
  total,
  wipLimit,
  onAdd,
  children,
}: {
  id: string;
  name: string;
  count: number;
  total: number;
  wipLimit: number | null;
  onAdd?: (title: string) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  return (
    <section
      ref={setNodeRef}
      aria-label={name}
      className={`flex w-72 shrink-0 flex-col rounded-lg border bg-surface-1 ${
        isOver
          ? "border-primary"
          : wipLimit !== null && total > wipLimit
            ? "border-critical/50"
            : "border-border"
      }`}
    >
      <header className="flex items-center justify-between px-3 py-2.5">
        <h2 className="text-sm font-medium">
          {name}{" "}
          <span className="ml-1 text-xs text-muted">
            {count}
            {count !== total && ` / ${total}`}
          </span>
          {wipLimit !== null && (
            <span
              title={
                total > wipLimit
                  ? `Over the WIP limit of ${wipLimit}`
                  : total === wipLimit
                    ? `At the WIP limit of ${wipLimit}`
                    : `WIP limit ${wipLimit}`
              }
              className={`ml-2 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                total > wipLimit
                  ? "border-critical/40 bg-critical/10 text-critical"
                  : total === wipLimit
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : "border-border text-muted"
              }`}
            >
              {total > wipLimit
                ? "Over limit "
                : total === wipLimit
                  ? "At limit "
                  : "Limit "}
              {total}/{wipLimit}
            </span>
          )}
        </h2>
      </header>
      <div className="flex min-h-12 flex-col gap-2 px-2 pb-2">{children}</div>
      {onAdd && (
        <div className="border-t border-border p-2">
          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) onAdd(title.trim());
                setTitle("");
                setAdding(false);
              }}
            >
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => !title && setAdding(false)}
                onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
                maxLength={200}
                placeholder="Task title, then Enter"
                aria-label={`New task in ${name}`}
                className="h-8 w-full rounded border border-border bg-background px-2 text-sm focus:border-primary focus:outline-none"
              />
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full rounded px-2 py-1 text-left text-sm text-muted hover:bg-surface-2 hover:text-foreground"
            >
              + Add task
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Card({ task }: { task: BoardTask }) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: task.id });
  // Cards are also drop targets so a drop can insert before them.
  const { setNodeRef: setDropRef } = useDroppable({ id: task.id });

  return (
    <div
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
      }}
      {...listeners}
      {...attributes}
      className={isDragging ? "opacity-40" : undefined}
    >
      <Link href={`/tasks/${task.id}`} draggable={false}>
        <CardBody task={task} />
      </Link>
    </div>
  );
}

function CardBody({ task, dragging }: { task: BoardTask; dragging?: boolean }) {
  return (
    <div
      className={`rounded border bg-surface-2 p-2.5 text-sm transition hover:border-muted/50 ${
        task.blocked ? "border-critical/50" : "border-border"
      } ${dragging ? "shadow-lg" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-muted">{task.key}</span>
        {task.blocked && (
          <span className="rounded border border-critical/30 bg-critical/10 px-1 text-[10px] font-medium text-critical">
            Blocked
          </span>
        )}
      </div>
      <p className="mt-1 leading-snug">{task.title}</p>
      {task.labels.length > 0 && (
        <div className="mt-2">
          <LabelChips labels={task.labels} />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] ${priorityStyle[task.priority]}`}
        >
          {priorityLabel(task.priority)}
        </span>
        {task.storyPoints !== null && (
          <span className="font-mono text-[11px] text-muted">
            {task.storyPoints} pts
          </span>
        )}
        {task.assignee && (
          <span
            title={task.assignee.name}
            className="ml-auto flex size-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-medium text-primary"
          >
            {task.assignee.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}
