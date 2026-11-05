"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./auth-provider";
import type { BoardColumn } from "@/lib/tasks";

const CATEGORIES = [
  { value: "BACKLOG", label: "Backlog" },
  { value: "TODO", label: "To do" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "IN_REVIEW", label: "In review" },
  { value: "DONE", label: "Done" },
];

const field =
  "h-8 rounded border border-border bg-background px-2 text-sm focus:border-primary focus:outline-none";

/**
 * Board column editor. The “type” of a column is what analytics uses (cycle
 * time starts at In progress / In review and ends at Done), so columns can be
 * renamed freely.
 */
export function ColumnSettings({
  projectId,
  columns,
  onChanged,
  onClose,
}: {
  projectId: string;
  columns: BoardColumn[];
  onChanged: () => Promise<unknown> | void;
  onClose: () => void;
}) {
  const { request } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BoardColumn | null>(null);
  const [moveTo, setMoveTo] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
    await onChanged();
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    act(() => request(`/statuses/${id}`, { method: "PATCH", body }));

  function move(index: number, delta: -1 | 1) {
    const ids = columns.map((c) => c.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    void act(() =>
      request(`/projects/${projectId}/statuses/order`, {
        method: "PUT",
        body: { ids },
      }),
    );
  }

  async function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await act(() =>
      request(
        `/statuses/${target.id}${target.tasks.length ? `?moveTo=${moveTo}` : ""}`,
        { method: "DELETE" },
      ),
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Board columns"
      className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-black/60 p-4 pt-16"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl rounded-lg border border-border bg-surface-1 p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div>
            <h2 className="text-lg font-semibold">Board columns</h2>
            <p className="mt-1 text-sm text-muted">
              Rename, reorder and add columns. The <strong>type</strong> tells
              analytics what a column means. A <strong>WIP limit</strong> flags
              a column when it holds more tasks than the team wants in progress;
              it’s a warning, not a block.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto text-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <ul className="mt-4 flex flex-col gap-2">
          {columns.map((c, i) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-2 rounded border border-border p-2"
            >
              <div className="flex flex-col">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${c.name} left`}
                  className="px-1 text-xs text-muted hover:text-foreground disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === columns.length - 1}
                  aria-label={`Move ${c.name} right`}
                  className="px-1 text-xs text-muted hover:text-foreground disabled:opacity-30"
                >
                  ▼
                </button>
              </div>
              <input
                defaultValue={c.name}
                key={`n-${c.id}-${c.name}`}
                maxLength={30}
                aria-label={`Name of ${c.name}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== c.name) void patch(c.id, { name: v });
                  else e.target.value = c.name;
                }}
                className={`${field} min-w-32 flex-1`}
              />
              <select
                value={c.category}
                aria-label={`Type of ${c.name}`}
                onChange={(e) => patch(c.id, { category: e.target.value })}
                className={field}
              >
                {CATEGORIES.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                WIP limit
                <input
                  type="number"
                  min={1}
                  max={99}
                  defaultValue={c.wipLimit ?? ""}
                  key={`w-${c.id}-${c.wipLimit}`}
                  placeholder="–"
                  aria-label={`WIP limit for ${c.name}`}
                  onBlur={(e) => {
                    const v =
                      e.target.value === "" ? null : Number(e.target.value);
                    if (v !== c.wipLimit) void patch(c.id, { wipLimit: v });
                  }}
                  className={`${field} w-16`}
                />
              </label>
              <button
                onClick={() => {
                  setDeleting(c);
                  setMoveTo(columns.find((o) => o.id !== c.id)?.id ?? "");
                }}
                disabled={columns.length <= 2}
                className="text-xs text-critical hover:underline disabled:opacity-30 disabled:no-underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>

        {deleting && (
          <div
            role="alertdialog"
            className="mt-3 rounded border border-warning/40 bg-warning/10 p-3 text-sm"
          >
            <p>
              Delete <strong>{deleting.name}</strong>?
              {deleting.tasks.length > 0 &&
                ` It has ${deleting.tasks.length} task${deleting.tasks.length === 1 ? "" : "s"}; they’ll be moved and the move is recorded in their history.`}
            </p>
            {deleting.tasks.length > 0 && (
              <label className="mt-2 flex items-center gap-2 text-xs">
                Move tasks to
                <select
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                  className={field}
                >
                  {columns
                    .filter((o) => o.id !== deleting.id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={confirmDelete}
                className="rounded bg-critical px-3 py-1 text-xs font-medium text-white hover:opacity-90"
              >
                Delete column
              </button>
              <button
                onClick={() => setDeleting(null)}
                className="rounded border border-border px-3 py-1 text-xs hover:bg-surface-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <AddColumn
          disabled={columns.length >= 12}
          onAdd={(body) =>
            act(() => request(`/projects/${projectId}/statuses`, { body }))
          }
        />

        {error && (
          <p
            role="alert"
            className="mt-3 rounded border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function AddColumn({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("IN_PROGRESS");
  const [limit, setLimit] = useState("");

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await onAdd({
          name,
          category,
          ...(limit ? { wipLimit: Number(limit) } : {}),
        });
        setName("");
        setLimit("");
      }}
      className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4"
    >
      <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs text-muted">
        New column
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={30}
          placeholder="e.g. Testing"
          disabled={disabled}
          className={field}
        />
      </label>
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label="Type of the new column"
        disabled={disabled}
        className={field}
      >
        {CATEGORIES.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        max={99}
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        placeholder="WIP"
        aria-label="WIP limit for the new column"
        disabled={disabled}
        className={`${field} w-20`}
      />
      <button
        disabled={disabled}
        className="h-8 rounded bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
      >
        Add column
      </button>
      {disabled && (
        <p className="w-full text-xs text-muted">
          A board can have at most 12 columns.
        </p>
      )}
    </form>
  );
}
