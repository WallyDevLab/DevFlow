"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./auth-provider";

type ResendState = "idle" | "sending" | "sent" | "error";

/** Asks the API to email a fresh confirmation link. */
export function ResendVerification({ className }: { className?: string }) {
  const { request } = useAuth();
  const [state, setState] = useState<ResendState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setState("sending");
    setError(null);
    try {
      await request("/auth/resend-verification", { method: "POST" });
      setState("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the link");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <span role="status" className={className}>
        Link sent. Check your inbox.
      </span>
    );
  }
  return (
    <>
      <button
        onClick={resend}
        disabled={state === "sending"}
        className={`underline hover:no-underline disabled:opacity-60 ${className ?? ""}`}
      >
        {state === "sending" ? "Sending…" : "Resend link"}
      </button>
      {error && (
        <span role="alert" className="ml-2 text-critical">
          {error}
        </span>
      )}
    </>
  );
}

/**
 * Shown to signed-in users whose email address isn't verified yet. Invitations
 * can't be accepted until it is. Re-checks when the tab regains focus, so
 * clicking the emailed link in another tab clears it.
 */
export function EmailVerificationBanner() {
  const { user, reloadUser } = useAuth();
  const unverified = !!user && !user.emailVerified;

  useEffect(() => {
    if (!unverified) return;
    const onFocus = () => void reloadUser().catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [unverified, reloadUser]);

  if (!user || user.emailVerified) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning"
    >
      <span>
        Confirm your email address: we sent a link to{" "}
        <span className="font-mono">{user.email}</span>. You’ll need it to
        accept workspace invitations.
      </span>
      <ResendVerification className="text-warning" />
    </div>
  );
}
