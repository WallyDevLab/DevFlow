"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AuthCard,
  ErrorBox,
  inputClass,
  primaryButton,
} from "@/components/auth-card";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const email = String(new FormData(e.currentTarget).get("email"));
    try {
      await api("/auth/forgot-password", { body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle={
        sent ? undefined : "Enter your email and we’ll send you a reset link."
      }
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            If that email is registered, a reset link is on its way. It expires
            in 1 hour.
          </p>
          <Link href="/login" className="text-sm text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className={inputClass}
            />
          </label>
          {error && <ErrorBox>{error}</ErrorBox>}
          <button disabled={busy} className={primaryButton}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <Link
            href="/login"
            className="text-center text-sm text-muted hover:text-foreground"
          >
            Back to sign in
          </Link>
        </form>
      )}
    </AuthCard>
  );
}
