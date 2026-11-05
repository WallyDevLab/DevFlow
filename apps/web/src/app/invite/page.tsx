"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ResendVerification } from "@/components/email-verification";
import { RequireAuth } from "@/components/require-auth";

export default function InvitePage() {
  // Keep the token in the URL through the sign-in redirect.
  return (
    <RequireAuth keepSearch>
      <Accept />
    </RequireAuth>
  );
}

function Accept() {
  const { user, request } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("This invitation link is missing its token.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { workspaceId } = await request<{ workspaceId: string }>(
        "/invitations/accept",
        { body: { token } },
      );
      router.replace(`/workspaces/${workspaceId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface-1 p-6">
        <h1 className="text-xl font-semibold tracking-tight">
          Join a workspace
        </h1>
        <p className="mt-1 text-sm text-muted">
          Accepting as <span className="font-mono">{user?.email}</span>. The
          invitation must have been sent to this email address.
        </p>
        {user && !user.emailVerified && (
          <p
            role="status"
            className="mt-4 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            Confirm your email address before accepting. We sent a link to{" "}
            <span className="font-mono">{user.email}</span>.{" "}
            <ResendVerification />
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
          >
            {error}
          </p>
        )}
        <button
          onClick={accept}
          disabled={busy || (!!user && !user.emailVerified)}
          className="mt-5 h-9 w-full rounded bg-primary text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? "Joining…" : "Accept invitation"}
        </button>
        <Link
          href="/dashboard"
          className="mt-3 block text-center text-sm text-muted hover:text-foreground"
        >
          Not now
        </Link>
      </div>
    </main>
  );
}
