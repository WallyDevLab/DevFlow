"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth-provider";
import { safeInternalPath, timeAgo } from "@/lib/time";

export interface NotificationItem {
  id: string;
  type: string;
  message: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 30_000;

/** Bell with an unread badge and a dropdown of recent notifications. */
export function NotificationBell() {
  const { request } = useAuth();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const pollCount = useCallback(
    () =>
      request<{ unreadCount: number }>("/notifications/unread-count")
        .then((r) => setUnread(r.unreadCount))
        .catch(() => undefined),
    [request],
  );

  // Keep the badge fresh: poll, and refresh when the tab regains focus.
  useEffect(() => {
    void pollCount();
    const timer = setInterval(pollCount, POLL_MS);
    const onFocus = () => void pollCount();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [pollCount]);

  const loadItems = useCallback(
    () =>
      request<{ items: NotificationItem[]; unreadCount: number }>(
        "/notifications?limit=10",
      )
        .then((r) => {
          setItems(r.items);
          setUnread(r.unreadCount);
        })
        .catch(() => undefined),
    [request],
  );

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void loadItems();
  }

  async function openItem(n: NotificationItem) {
    setOpen(false);
    if (!n.readAt) {
      setUnread((u) => Math.max(0, u - 1));
      await request(`/notifications/${n.id}/read`, { method: "POST" }).catch(
        () => undefined,
      );
    }
    router.push(safeInternalPath(n.link));
  }

  async function markAll() {
    await request("/notifications/read-all", { method: "POST" }).catch(
      () => undefined,
    );
    setUnread(0);
    setItems(
      (prev) =>
        prev?.map((n) => ({
          ...n,
          readAt: n.readAt ?? new Date().toISOString(),
        })) ?? null,
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={toggle}
        aria-label={
          unread ? `Notifications, ${unread} unread` : "Notifications"
        }
        aria-expanded={open}
        aria-haspopup="true"
        className="relative flex size-8 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface-1 shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-medium">Notifications</p>
            <button
              onClick={markAll}
              disabled={unread === 0}
              className="text-xs text-primary hover:underline disabled:text-muted disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 divide-y divide-border overflow-auto">
            {items === null && (
              <li className="px-3 py-4 text-sm text-muted">Loading…</li>
            )}
            {items?.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted">
                You’re all caught up.
              </li>
            )}
            {items?.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => openItem(n)}
                  className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-surface-2"
                >
                  <span
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-primary"}`}
                    aria-label={n.readAt ? undefined : "Unread"}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-sm ${n.readAt ? "text-muted" : ""}`}
                    >
                      {n.message}
                    </span>
                    <span className="text-xs text-muted">
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-3 py-2 text-center text-xs text-primary hover:bg-surface-2"
          >
            View all and settings
          </Link>
        </div>
      )}
    </div>
  );
}
