"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "./auth-provider";
import { describeActivity } from "@/lib/activity";
import { timeAgo } from "@/lib/time";

interface FeedItem {
  id: string;
  type: string;
  data: Record<string, unknown> | null;
  actor: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  createdAt: string;
}

/** Recent task activity across a workspace's projects. */
export function ActivityFeed({ workspaceId }: { workspaceId: string }) {
  const { request } = useAuth();
  const [items, setItems] = useState<FeedItem[] | null>(null);

  useEffect(() => {
    request<FeedItem[]>(`/workspaces/${workspaceId}/activity`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [workspaceId, request]);

  if (items === null)
    return <p className="mt-3 text-sm text-muted">Loading…</p>;
  if (items.length === 0) {
    return (
      <p className="mt-3 rounded border border-dashed border-border p-6 text-center text-sm text-muted">
        No activity yet.
      </p>
    );
  }
  return (
    <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-1">
      {items.map((e) => (
        <li key={e.id} className="px-4 py-2.5 text-sm">
          <span className="font-medium">{e.actor}</span>{" "}
          <span className="text-muted">{describeActivity(e.type, e.data)}</span>{" "}
          <Link href={`/tasks/${e.taskId}`} className="hover:underline">
            <span className="font-mono text-[11px] text-muted">
              {e.taskKey}
            </span>{" "}
            <span className="text-muted">{e.taskTitle}</span>
          </Link>
          <span className="ml-2 text-xs text-muted/70">
            {timeAgo(e.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
