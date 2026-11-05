"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-provider";

interface Status {
  configured: boolean;
  canManage: boolean;
  installation: { accountLogin: string; accountType: string } | null;
  installUrl: string | null;
}

/** GitHub connection card for a workspace (owners and admins only). */
export function GitHubPanel({ workspaceId }: { workspaceId: string }) {
  const { request } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      request<Status>(`/workspaces/${workspaceId}/integrations/github`)
        .then(setStatus)
        .catch((e) =>
          setError(e instanceof Error ? e.message : "Failed to load"),
        ),
    [workspaceId, request],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function disconnect() {
    if (
      !confirm(
        "Disconnect GitHub? DevFlow will lose access to your repositories and stop receiving pull request updates.",
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await request<{ revokedOnGitHub: boolean }>(
        `/workspaces/${workspaceId}/integrations/github`,
        { method: "DELETE" },
      );
      if (!res.revokedOnGitHub) {
        setError(
          "Disconnected here, but GitHub couldn’t be reached to revoke access. Remove the app from your GitHub settings to be sure.",
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't disconnect");
    }
  }

  if (!status)
    return error ? <p className="text-sm text-critical">{error}</p> : null;

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">GitHub</p>
          <p className="text-xs text-muted">
            {status.installation
              ? `Connected to ${status.installation.accountLogin} (${status.installation.accountType.toLowerCase()})`
              : status.configured
                ? "Link pull requests and branches to your tasks."
                : "Not configured on this server yet."}
          </p>
        </div>
        {status.installUrl && (
          <a
            href={status.installUrl}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Connect GitHub
          </a>
        )}
        {status.installation && (
          <button
            onClick={disconnect}
            className="rounded border border-border px-3 py-1.5 text-sm text-critical hover:bg-surface-2"
          >
            Disconnect
          </button>
        )}
      </div>
      {!status.configured && !status.installation && (
        <p className="mt-3 text-xs text-muted">
          An administrator needs to register a GitHub App and set the
          <code className="mx-1 font-mono">GITHUB_*</code>
          variables in <code className="font-mono">apps/api/.env</code>. See the
          setup notes in the README.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
