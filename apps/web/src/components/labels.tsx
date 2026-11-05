"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-provider";

export interface Label {
  id: string;
  name: string;
  color: string;
}

// Swatches offered when creating a label (the project's validated categorical
// hues for the dark surface). Any #rrggbb is accepted by the API.
export const LABEL_COLORS = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];

/** Colour lives on the dot; the text stays in the normal text colour. */
export function LabelChip({
  label,
  onRemove,
}: {
  label: Label;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-foreground">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: label.color }}
        aria-hidden
      />
      <span className="truncate">{label.name}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove label ${label.name}`}
          className="text-muted hover:text-foreground"
        >
          ×
        </button>
      )}
    </span>
  );
}

/** Up to `max` chips, then “+n”. */
export function LabelChips({
  labels,
  max = 3,
}: {
  labels: Label[];
  max?: number;
}) {
  if (!labels.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {labels.slice(0, max).map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      {labels.length > max && (
        <span className="px-1 text-[11px] text-muted">
          +{labels.length - max}
        </span>
      )}
    </div>
  );
}

function useProjectLabels(projectId: string) {
  const { request } = useAuth();
  const [labels, setLabels] = useState<Label[]>([]);
  const reload = useCallback(
    () =>
      request<Label[]>(`/projects/${projectId}/labels`)
        .then(setLabels)
        .catch(() => undefined),
    [projectId, request],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { labels, reload };
}

function NewLabelForm({
  projectId,
  onCreated,
  onError,
}: {
  projectId: string;
  onCreated: (label: Label) => void;
  onError: (message: string | null) => void;
}) {
  const { request } = useAuth();
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    try {
      const label = await request<Label>(`/projects/${projectId}/labels`, {
        body: { name, color },
      });
      setName("");
      onCreated(label);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't create label");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={30}
        placeholder="New label name"
        aria-label="New label name"
        className="h-8 rounded border border-border bg-background px-2 text-sm focus:border-primary focus:outline-none"
      />
      <div
        className="flex items-center gap-1.5"
        role="radiogroup"
        aria-label="Label colour"
      >
        {LABEL_COLORS.map((c) => (
          <button
            type="button"
            key={c}
            role="radio"
            aria-checked={color === c}
            aria-label={c}
            onClick={() => setColor(c)}
            className={`size-5 rounded-full ${
              color === c
                ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface-1"
                : ""
            }`}
            style={{ background: c }}
          />
        ))}
        <button className="ml-auto rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover">
          Create
        </button>
      </div>
    </form>
  );
}

/** Label editor for a task: remove, add existing, or create new. */
export function LabelPicker({
  projectId,
  selected,
  disabled,
  onChange,
}: {
  projectId: string;
  selected: Label[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const { labels, reload } = useProjectLabels(projectId);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = selected.map((l) => l.id);
  const available = labels.filter((l) => !ids.includes(l.id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {selected.length === 0 && (
          <span className="text-xs text-muted">No labels</span>
        )}
        {selected.map((l) => (
          <LabelChip
            key={l.id}
            label={l}
            onRemove={
              disabled
                ? undefined
                : () => onChange(ids.filter((i) => i !== l.id))
            }
          />
        ))}
      </div>
      {!disabled && (
        <>
          {available.length > 0 && (
            <select
              aria-label="Add label"
              value=""
              onChange={(e) =>
                e.target.value && onChange([...ids, e.target.value])
              }
              className="h-8 rounded border border-border bg-background px-2 text-sm"
            >
              <option value="">Add label…</option>
              {available.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          {creating ? (
            <NewLabelForm
              projectId={projectId}
              onError={setError}
              onCreated={async (label) => {
                setCreating(false);
                await reload();
                onChange([...ids, label.id]);
              }}
            />
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-fit text-xs text-primary hover:underline"
            >
              + New label
            </button>
          )}
          {error && <p className="text-xs text-critical">{error}</p>}
        </>
      )}
    </div>
  );
}

/** Project-level label list (rename / delete / create) for the board. */
export function LabelManager({
  projectId,
  canPlan,
  onChanged,
}: {
  projectId: string;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const { request } = useAuth();
  const { labels, reload } = useProjectLabels(projectId);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
      >
        Labels
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-border bg-surface-1 p-3 shadow-lg">
          {labels.length === 0 ? (
            <p className="text-xs text-muted">No labels yet.</p>
          ) : (
            <ul className="max-h-56 divide-y divide-border overflow-auto">
              {labels.map((l) => (
                <li key={l.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <LabelChip label={l} />
                  </span>
                  {canPlan && (
                    <>
                      <button
                        onClick={() => {
                          const name = prompt("Rename label", l.name)?.trim();
                          if (name && name !== l.name) {
                            void act(() =>
                              request(`/labels/${l.id}`, {
                                method: "PATCH",
                                body: { name },
                              }),
                            );
                          }
                        }}
                        className="text-xs text-muted hover:text-foreground"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() =>
                          confirm(
                            `Delete “${l.name}”? It will be removed from every task.`,
                          ) &&
                          act(() =>
                            request(`/labels/${l.id}`, { method: "DELETE" }),
                          )
                        }
                        className="text-xs text-critical hover:underline"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t border-border pt-3">
            <NewLabelForm
              projectId={projectId}
              onError={setError}
              onCreated={async () => {
                await reload();
                onChanged();
              }}
            />
          </div>
          {error && <p className="mt-2 text-xs text-critical">{error}</p>}
        </div>
      )}
    </div>
  );
}
