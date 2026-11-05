"use client";

import Link from "next/link";
import { useAuth } from "./auth-provider";
import { NotificationBell } from "./notification-bell";

/** Slim global header, shown only to signed-in users. */
export function AppBar() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <header className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur">
      <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
        DevFlow
      </Link>
      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <Link
          href="/account"
          className="max-w-40 truncate rounded px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
        >
          {user.name}
        </Link>
      </div>
    </header>
  );
}
