"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ActivityFeed } from "@/components/activity-feed";
import { GitHubPanel } from "@/components/github-panel";
import { RequireAuth } from "@/components/require-auth";
import { ASSIGNABLE_ROLES, roleLabel, type Role } from "@/lib/roles";

interface Workspace {
  id: string;
  name: string;
  role: Role;
}
interface Project {
  id: string;
  name: string;
  key: string;
  status: string;
}
interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
}
interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

const selectClass =
  "h-8 rounded border border-border bg-background px-2 text-sm focus:border-primary focus:outline-none";

export default function WorkspacePage() {
  return (
    <RequireAuth>
      <WorkspaceView />
    </RequireAuth>
  );
}

function WorkspaceView() {
  const { id } = useParams<{ id: string }>();
  const { user, request } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectName, setProjectName] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteEmailed, setInviteEmailed] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("DEVELOPER");

  const canManage = workspace?.role === "OWNER" || workspace?.role === "ADMIN";
  const isOwner = workspace?.role === "OWNER";

  // Fetches everything; state is only touched in the callbacks below.
  const refresh = useCallback(
    () =>
      (async () => {
        const ws = await request<Workspace>(`/workspaces/${id}`);
        const mem = await request<Member[]>(`/workspaces/${id}/members`);
        const inv =
          ws.role === "OWNER" || ws.role === "ADMIN"
            ? await request<Invitation[]>(`/workspaces/${id}/invitations`)
            : [];
        const proj = await request<Project[]>(`/workspaces/${id}/projects`);
        return { ws, mem, inv, proj };
      })()
        .then(({ ws, mem, inv, proj }) => {
          setProjects(proj);
          setWorkspace(ws);
          setMembers(mem);
          setInvitations(inv);
        })
        .catch((e) => {
          if (e instanceof Error && e.message === "Workspace not found") {
            setNotFound(true);
          } else {
            setError(e instanceof Error ? e.message : "Something went wrong");
          }
        }),
    [id, request],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    await act(async () => {
      const res = await request<{ token: string; emailed: boolean }>(
        `/workspaces/${id}/invitations`,
        { body: { email: inviteEmail, role: inviteRole } },
      );
      setInviteEmailed(res.emailed);
      setInviteLink(`${window.location.origin}/invite?token=${res.token}`);
      setInviteEmail("");
    });
  }

  if (notFound) {
    return (
      <main className="mx-auto w-full max-w-3xl p-8">
        <p className="text-muted">Workspace not found.</p>
        <Link href="/dashboard" className="text-primary hover:underline">
          Back to dashboard
        </Link>
      </main>
    );
  }
  if (!workspace) return null;

  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Link
        href="/dashboard"
        className="text-sm text-muted hover:text-foreground"
      >
        ← All workspaces
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {workspace.name}
      </h1>
      <p className="text-sm text-muted">
        Your role: {roleLabel(workspace.role)}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
        >
          {error}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">Projects</h2>
        {projects.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-border p-6 text-center text-sm text-muted">
            No projects yet.
            {canManage ? "" : " An owner or admin can create one."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-1">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2"
                >
                  <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                    {p.key}
                  </span>
                  <span className="flex-1 font-medium">{p.name}</span>
                  {p.status === "ARCHIVED" && (
                    <span className="text-xs text-warning">Archived</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await request(`/workspaces/${id}/projects`, {
                  body: { name: projectName, key: projectKey },
                });
                setProjectName("");
                setProjectKey("");
              });
            }}
            className="mt-3 flex gap-2"
          >
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              placeholder="New project name"
              aria-label="Project name"
              className="h-9 flex-1 rounded border border-border bg-background px-3 text-sm placeholder:text-muted focus:border-primary focus:outline-none"
            />
            <input
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              required
              pattern="[A-Z][A-Z0-9]{1,4}"
              maxLength={5}
              placeholder="KEY"
              aria-label="Project key"
              title="2-5 letters or digits, starting with a letter"
              className="h-9 w-24 rounded border border-border bg-background px-3 font-mono text-sm placeholder:text-muted focus:border-primary focus:outline-none"
            />
            <button className="h-9 rounded bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
              Create
            </button>
          </form>
        )}
      </section>

      {canManage && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-muted">Integrations</h2>
          <GitHubPanel workspaceId={id} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">Recent activity</h2>
        <ActivityFeed workspaceId={id} />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">
          Members ({members.length})
        </h2>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-1">
          {members.map((m) => {
            const self = m.userId === user?.id;
            const canRemove =
              m.role !== "OWNER" &&
              (self ||
                isOwner ||
                (workspace.role === "ADMIN" && m.role !== "ADMIN"));
            return (
              <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.name}
                    {self && (
                      <span className="ml-2 text-xs text-muted">you</span>
                    )}
                  </p>
                  <p className="truncate font-mono text-xs text-muted">
                    {m.email}
                  </p>
                </div>
                {isOwner && m.role !== "OWNER" ? (
                  <select
                    aria-label={`Role for ${m.name}`}
                    value={m.role}
                    onChange={(e) =>
                      act(() =>
                        request(`/workspaces/${id}/members/${m.userId}`, {
                          method: "PATCH",
                          body: { role: e.target.value },
                        }),
                      )
                    }
                    className={selectClass}
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-muted">
                    {roleLabel(m.role)}
                  </span>
                )}
                {canRemove && (
                  <button
                    onClick={() =>
                      confirm(
                        self ? "Leave this workspace?" : `Remove ${m.name}?`,
                      ) &&
                      act(() =>
                        request(`/workspaces/${id}/members/${m.userId}`, {
                          method: "DELETE",
                        }),
                      )
                    }
                    className="text-xs text-critical hover:underline"
                  >
                    {self ? "Leave" : "Remove"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {canManage && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-muted">Invite a teammate</h2>
          <form onSubmit={invite} className="mt-3 flex flex-wrap gap-2">
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              aria-label="Email"
              className="h-9 min-w-48 flex-1 rounded border border-border bg-background px-3 text-sm placeholder:text-muted focus:border-primary focus:outline-none"
            />
            <select
              aria-label="Role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              className={`${selectClass} h-9`}
            >
              {ASSIGNABLE_ROLES.filter((r) => isOwner || r !== "ADMIN").map(
                (r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ),
              )}
            </select>
            <button className="h-9 rounded bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
              Create invite
            </button>
          </form>

          {inviteLink && (
            <div className="mt-3 rounded border border-border bg-surface-1 p-3">
              <p className="text-xs text-muted">
                {inviteEmailed
                  ? "We’ve emailed them the invitation. You can also share this link; it’s shown only once and expires in 7 days."
                  : "Email isn’t set up on this server, so nothing was sent. Share this link with them; it’s shown only once and expires in 7 days."}
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  value={inviteLink}
                  aria-label="Invitation link"
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-8 flex-1 rounded border border-border bg-background px-2 font-mono text-xs"
                />
                <button
                  onClick={() => navigator.clipboard?.writeText(inviteLink)}
                  className="rounded border border-border px-3 text-xs hover:bg-surface-2"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {invitations.length > 0 && (
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface-1">
              {invitations.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="flex-1 truncate font-mono text-xs">
                    {inv.email}
                  </span>
                  <span className="text-xs text-muted">
                    Pending · {roleLabel(inv.role)}
                  </span>
                  <button
                    onClick={() =>
                      act(() =>
                        request(`/workspaces/${id}/invitations/${inv.id}`, {
                          method: "DELETE",
                        }),
                      )
                    }
                    className="text-xs text-critical hover:underline"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
