"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { RequireAuth } from "@/components/require-auth";
import { roleLabel, type Role } from "@/lib/roles";

interface WorkspaceSummary {
  id: string;
  name: string;
  role: Role;
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  );
}

function Dashboard() {
  const { user, logout, request } = useAuth();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    request<WorkspaceSummary[]>("/workspaces")
      .then(setWorkspaces)
      .catch((e) => setError(e.message));
  }, [request]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const ws = await request<WorkspaceSummary>("/workspaces", {
        body: { name },
      });
      router.push(`/workspaces/${ws.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {user?.name}
        </h1>
        <button
          onClick={async () => {
            await logout();
            router.replace("/login");
          }}
          className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
        >
          Sign out
        </button>
      </header>
      <Link
        href="/account"
        className="mt-1 inline-block text-sm text-muted hover:text-foreground"
      >
        Account settings
      </Link>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">Your workspaces</h2>
        {workspaces === null ? (
          <p className="mt-3 text-sm text-muted">Loading…</p>
        ) : workspaces.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-border p-6 text-center text-sm text-muted">
            You don’t belong to any workspace yet. Create one below, or open an
            invitation link from a teammate.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-1">
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/workspaces/${w.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-surface-2"
                >
                  <span className="font-medium">{w.name}</span>
                  <span className="text-xs text-muted">
                    {roleLabel(w.role)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">Create a workspace</h2>
        <form onSubmit={create} className="mt-3 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={60}
            placeholder="e.g. Acme Engineering"
            aria-label="Workspace name"
            className="h-9 flex-1 rounded border border-border bg-background px-3 text-sm placeholder:text-muted focus:border-primary focus:outline-none"
          />
          <button
            disabled={creating}
            className="h-9 rounded bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-sm text-critical">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
