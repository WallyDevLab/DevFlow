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

export default function ResetPasswordPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError("The two passwords don’t match.");
      return;
    }
    // Read at submit time so the page doesn't need a Suspense boundary.
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("This link is missing its reset code. Request a new one.");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/reset-password", { body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Password updated">
        <p role="status" className="text-sm text-muted">
          Your password has been changed and you’ve been signed out everywhere.
        </p>
        <Link
          href="/login"
          className={`${primaryButton} mt-5 flex items-center justify-center`}
        >
          Sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          New password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            className={inputClass}
          />
          <span className="text-xs font-normal text-muted">
            At least 8 characters
          </span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Confirm new password
          <input
            name="confirm"
            type="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
        {error && (
          <div className="flex flex-col gap-2">
            <ErrorBox>{error}</ErrorBox>
            <Link
              href="/forgot-password"
              className="text-sm text-primary hover:underline"
            >
              Request a new link
            </Link>
          </div>
        )}
        <button disabled={busy} className={primaryButton}>
          {busy ? "Saving…" : "Set new password"}
        </button>
      </form>
    </AuthCard>
  );
}
