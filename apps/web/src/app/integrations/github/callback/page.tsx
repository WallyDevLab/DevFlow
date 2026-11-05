"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { RequireAuth } from "@/components/require-auth";

// GitHub redirects here after the app is installed. The one-time `code` and
// `state` are passed to our API, which verifies them against GitHub.
export default function GitHubCallbackPage() {
  return (
    <RequireAuth keepSearch>
      <Callback />
    </RequireAuth>
  );
}

function Callback() {
  const { request } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // The code is single-use, so guard against React strict mode running this twice.
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const installationId = Number(params.get("installation_id"));
    const code = params.get("code");
    const state = params.get("state");
    const run =
      !installationId || !code || !state
        ? Promise.reject(
            new Error(
              "This link is missing information from GitHub. Try connecting again.",
            ),
          )
        : request<{ workspaceId: string }>(
            "/integrations/github/installations",
            {
              body: { installationId, code, state },
            },
          );
    run
      .then(({ workspaceId }) => router.replace(`/workspaces/${workspaceId}`))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Something went wrong"),
      );
  }, [request, router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface-1 p-6 text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold">Couldn’t connect GitHub</h1>
            <p role="alert" className="mt-2 text-sm text-critical">
              {error}
            </p>
            <Link
              href="/dashboard"
              className="mt-4 inline-block text-sm text-primary hover:underline"
            >
              Back to dashboard
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted">Connecting to GitHub…</p>
        )}
      </div>
    </main>
  );
}
