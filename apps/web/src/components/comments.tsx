"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "./auth-provider";

interface Comment {
  id: string;
  body: string;
  author: { id: string; name: string };
  createdAt: string;
  edited: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface Mentionable {
  userId: string;
  name: string;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Ids of the people whose "@Name" appears in the text. */
const mentionedIds = (text: string, members: Mentionable[]) =>
  members.filter((m) => text.includes(`@${m.name}`)).map((m) => m.userId);

/** Plain text with @Name highlighted. Never HTML. */
function Body({ text, members }: { text: string; members: Mentionable[] }) {
  const parts = useMemo(() => {
    if (!members.length) return [text];
    // Longest names first so "@Ann Lee" wins over "@Ann".
    const names = members
      .map((m) => escapeRegex(m.name))
      .sort((a, b) => b.length - a.length);
    return text.split(new RegExp(`(@(?:${names.join("|")}))`, "g"));
  }, [text, members]);
  return (
    <p className="mt-2 whitespace-pre-wrap break-words text-sm">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            className="rounded bg-primary/15 px-0.5 font-medium text-primary"
          >
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

/** Textarea that suggests workspace members after typing "@". */
function MentionTextarea({
  value,
  onChange,
  members,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  members: Mentionable[];
} & Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);

  function update(text: string, caret: number) {
    onChange(text);
    // An "@" at the start of a word, followed by letters/spaces typed so far.
    const m = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
    setQuery(m ? m[1].toLowerCase() : null);
  }

  const suggestions =
    query === null
      ? []
      : members
          .filter(
            (m) =>
              m.name.toLowerCase().replace(/\s+/g, "").includes(query) ||
              m.name.toLowerCase().includes(query),
          )
          .slice(0, 5);

  function pick(m: Mentionable) {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@[^\s@]*$/, `@${m.name} `);
    const next = before + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => update(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => e.key === "Escape" && setQuery(null)}
        {...rest}
      />
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Mention suggestions"
          className="absolute left-2 top-full z-10 mt-1 w-56 rounded-lg border border-border bg-surface-1 py-1 shadow-lg"
        >
          {suggestions.map((m) => (
            <li key={m.userId} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the textarea
                  pick(m);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-medium text-primary">
                  {m.name.charAt(0).toUpperCase()}
                </span>
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Discussion thread on a task. Comment text is rendered as plain text. */
export function Comments({
  taskId,
  canComment,
  members = [],
}: {
  taskId: string;
  canComment: boolean;
  members?: Mentionable[];
}) {
  const { request } = useAuth();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      request<Comment[]>(`/tasks/${taskId}/comments`)
        .then(setComments)
        .catch((e) =>
          setError(e instanceof Error ? e.message : "Couldn't load comments"),
        ),
    [taskId, request],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    await act(async () => {
      await request(`/tasks/${taskId}/comments`, {
        body: { body: draft, mentionIds: mentionedIds(draft, members) },
      });
      setDraft("");
    });
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium text-muted">
        Comments{comments ? ` (${comments.length})` : ""}
      </h2>

      {comments?.length === 0 && (
        <p className="mt-2 text-sm text-muted">No comments yet.</p>
      )}

      <ul className="mt-3 flex flex-col gap-3">
        {comments?.map((c) => (
          <li
            key={c.id}
            className="rounded-lg border border-border bg-surface-1 p-3"
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-medium text-primary">
                {c.author.name.charAt(0).toUpperCase()}
              </span>
              <span className="font-medium">{c.author.name}</span>
              <time className="text-muted" dateTime={c.createdAt}>
                {new Date(c.createdAt).toLocaleString()}
              </time>
              {c.edited && <span className="text-muted">(edited)</span>}
              <span className="ml-auto flex gap-3">
                {c.canEdit && editing?.id !== c.id && (
                  <button
                    onClick={() => setEditing({ id: c.id, body: c.body })}
                    className="text-muted hover:text-foreground"
                  >
                    Edit
                  </button>
                )}
                {c.canDelete && (
                  <button
                    onClick={() =>
                      confirm("Delete this comment?") &&
                      act(() =>
                        request(`/comments/${c.id}`, { method: "DELETE" }),
                      )
                    }
                    className="text-critical hover:underline"
                  >
                    Delete
                  </button>
                )}
              </span>
            </div>

            {editing?.id === c.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await request(`/comments/${c.id}`, {
                      method: "PATCH",
                      body: {
                        body: editing.body,
                        mentionIds: mentionedIds(editing.body, members),
                      },
                    });
                    setEditing(null);
                  });
                }}
                className="mt-2 flex flex-col gap-2"
              >
                <MentionTextarea
                  value={editing.body}
                  onChange={(v) => setEditing({ id: c.id, body: v })}
                  members={members}
                  rows={3}
                  maxLength={5000}
                  aria-label="Edit comment"
                  className="w-full rounded border border-border bg-background p-2 text-sm focus:border-primary focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    disabled={busy || !editing.body.trim()}
                    className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded border border-border px-3 py-1 text-xs hover:bg-surface-2"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <Body text={c.body} members={members} />
            )}
          </li>
        ))}
      </ul>

      {canComment ? (
        <form onSubmit={post} className="mt-3 flex flex-col gap-2">
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            members={members}
            rows={3}
            maxLength={5000}
            placeholder="Write a comment… use @ to mention a teammate"
            aria-label="New comment"
            className="w-full rounded border border-border bg-background p-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none"
          />
          <button
            disabled={busy || !draft.trim()}
            className="w-fit rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
          >
            Comment
          </button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-muted">
          You have read-only access to this project.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-critical">
          {error}
        </p>
      )}
    </section>
  );
}
