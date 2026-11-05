"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { NotificationItem } from "@/components/notification-bell";
import { RequireAuth } from "@/components/require-auth";
import { safeInternalPath, timeAgo } from "@/lib/time";

interface Pref {
  type: string;
  label: string;
  description: string;
  inApp: boolean;
}

export default function NotificationsPage() {
  return (
    <RequireAuth>
      <Inbox />
    </RequireAuth>
  );
}

function Inbox() {
  const { request } = useAuth();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      request<{ items: NotificationItem[]; unreadCount: number }>(
        `/notifications?limit=50${unreadOnly ? "&unread=true" : ""}`,
      )
        .then((r) => {
          setItems(r.items);
          setUnread(r.unreadCount);
        })
        .catch((e) =>
          setError(e instanceof Error ? e.message : "Failed to load"),
        ),
    [request, unreadOnly],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    request<Pref[]>("/notifications/preferences")
      .then(setPrefs)
      .catch(() => undefined);
  }, [request]);

  async function markRead(id: string) {
    await request(`/notifications/${id}/read`, { method: "POST" }).catch(
      () => undefined,
    );
    await load();
  }

  async function markAll() {
    await request("/notifications/read-all", { method: "POST" }).catch(
      () => undefined,
    );
    await load();
  }

  async function toggle(p: Pref) {
    setError(null);
    setPrefs((prev) =>
      prev.map((x) => (x.type === p.type ? { ...x, inApp: !p.inApp } : x)),
    );
    try {
      await request("/notifications/preferences", {
        method: "PUT",
        body: { type: p.type, inApp: !p.inApp },
      });
    } catch (e) {
      setPrefs((prev) =>
        prev.map((x) => (x.type === p.type ? { ...x, inApp: p.inApp } : x)),
      );
      setError(e instanceof Error ? e.message : "Couldn't save");
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>

      <div className="mt-6 flex items-center gap-2">
        <div
          role="tablist"
          className="flex rounded border border-border text-sm"
        >
          {[
            { label: "All", value: false },
            { label: `Unread${unread ? ` (${unread})` : ""}`, value: true },
          ].map((t) => (
            <button
              key={t.label}
              role="tab"
              aria-selected={unreadOnly === t.value}
              onClick={() => setUnreadOnly(t.value)}
              className={`px-3 py-1 ${unreadOnly === t.value ? "bg-surface-2 font-medium" : "text-muted hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={markAll}
          disabled={unread === 0}
          className="ml-auto text-sm text-primary hover:underline disabled:text-muted disabled:no-underline"
        >
          Mark all read
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      )}

      <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-1">
        {items === null && (
          <li className="px-4 py-6 text-sm text-muted">Loading…</li>
        )}
        {items?.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-muted">
            {unreadOnly ? "Nothing unread." : "No notifications yet."}
          </li>
        )}
        {items?.map((n) => (
          <li key={n.id} className="flex items-start gap-3 px-4 py-3">
            <span
              className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-primary"}`}
              aria-label={n.readAt ? undefined : "Unread"}
            />
            <div className="min-w-0 flex-1">
              <Link
                href={safeInternalPath(n.link)}
                onClick={() =>
                  !n.readAt &&
                  void request(`/notifications/${n.id}/read`, {
                    method: "POST",
                  })
                }
                className={`text-sm hover:underline ${n.readAt ? "text-muted" : ""}`}
              >
                {n.message}
              </Link>
              <p className="text-xs text-muted">{timeAgo(n.createdAt)}</p>
            </div>
            {!n.readAt && (
              <button
                onClick={() => markRead(n.id)}
                className="text-xs text-muted hover:text-foreground"
              >
                Mark read
              </button>
            )}
          </li>
        ))}
      </ul>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-muted">
          What should notify you?
        </h2>
        <p className="mt-1 text-sm text-muted">
          In-app notifications only for now. Turn off the kinds you don’t need.
        </p>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-1">
          {prefs.map((p) => (
            <li key={p.type}>
              <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={p.inApp}
                  onChange={() => toggle(p)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block text-xs text-muted">
                    {p.description}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
