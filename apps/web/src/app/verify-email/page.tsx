"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AuthCard, ErrorBox, primaryButton } from "@/components/auth-card";
import { useAuth } from "@/components/auth-provider";
import { ResendVerification } from "@/components/email-verification";
import { api } from "@/lib/api";

type Status = "verifying" | "done" | "failed";

// The link is single-use, so the request must be made exactly once even though
// React may run the effect twice in development.
export default function VerifyEmailPage() {
  const { user, loading, reloadUser } = useAuth();
  const [status, setStatus] = useState<Status>("verifying");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get("token");
    const run = token
      ? api("/auth/verify-email", { body: { token } })
      : Promise.reject(
          new Error("This link is missing its verification code."),
        );
    run
      .then(() => {
        setStatus("done");
        // If this browser is signed in, clear the "verify your email" banner.
        return reloadUser().catch(() => undefined);
      })
      .catch((e) => {
        setStatus("failed");
        setMessage(e instanceof Error ? e.message : "Something went wrong");
      });
  }, [reloadUser]);

  if (status === "verifying") {
    return (
      <AuthCard title="Confirming your email…">
        <p className="text-sm text-muted">One moment.</p>
      </AuthCard>
    );
  }

  if (status === "done") {
    return (
      <AuthCard title="Email confirmed">
        <p role="status" className="text-sm text-muted">
          Thanks, your address is verified. You can now accept workspace
          invitations.
        </p>
        <Link
          href={user ? "/dashboard" : "/login"}
          className={`${primaryButton} mt-5 flex items-center justify-center`}
        >
          {user ? "Go to the dashboard" : "Sign in"}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Couldn’t confirm your email">
      <div className="flex flex-col gap-4">
        <ErrorBox>{message}</ErrorBox>
        {!loading && user ? (
          <p className="text-sm text-muted">
            Ask for a new link: <ResendVerification />
          </p>
        ) : (
          <p className="text-sm text-muted">
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>{" "}
            to request a new link.
          </p>
        )}
      </div>
    </AuthCard>
  );
}
