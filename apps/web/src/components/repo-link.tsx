"use client";

import { useState } from "react";
import { useAuth } from "./auth-provider";

interface Repo {
  id: number;
  fullName: string;
  private: boolean;
  linkedProjectId: string | null;
}

/** Shows the project's linked repository; owners/admins can change it. */
export function RepoLink({
  projectId,
  workspaceId,
  repository,
  canManage,
  onChange,
}: {
  projectId: string;
  workspaceId: string;
  repository: string | null;
  canManage: boolean;
  onChange: () => void;
}) {
  const { request } = useAuth();
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openPicker() {
    setError(null);
    try {
      setRepos(
        await request<Repo[]>(
          `/workspaces/${workspaceId}/integrations/github/repositories`,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(
        msg === "GitHub is not connected"
          ? "Connect GitHub from the workspace page first."
          : msg || "Couldn't load repositories",
      );
    }
  }

  async function link(fullName: string) {
    setError(null);
    try {
      await request(`/projects/${projectId}/repository`, {
        method: "PUT",
        body: { fullName },
      });
      setRepos(null);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't link repository");
    }
  }

  async function unlink() {
    await request(`/projects/${projectId}/repository`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="relative flex items-center gap-2 text-xs">
      {repository ? (
        <>
          <span className="rounded border border-border bg-surface-2 px-2 py-1 font-mono text-muted">
            {repository}
          </span>
          {canManage && (
            <button onClick={unlink} className="text-muted hover:text-critical">
              Unlink
            </button>
          )}
        </>
      ) : (
        canManage && (
          <button
            onClick={repos ? () => setRepos(null) : openPicker}
            className="rounded border border-border px-2.5 py-1 hover:bg-surface-2"
          >
            Link GitHub repository
          </button>
        )
      )}
      {repos && (
        <ul className="absolute left-0 top-full z-10 mt-1 w-64 divide-y divide-border rounded-lg border border-border bg-surface-1 shadow-lg">
          {repos.length === 0 && (
            <li className="px-3 py-2 text-muted">
              No repositories shared with the app.
            </li>
          )}
          {repos.map((r) => (
            <li key={r.id}>
              <button
                disabled={r.linkedProjectId !== null}
                onClick={() => link(r.fullName)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-50"
              >
                <span className="font-mono">{r.fullName}</span>
                {r.linkedProjectId && (
                  <span className="text-muted">in use</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <span className="text-critical">{error}</span>}
    </div>
  );
}
