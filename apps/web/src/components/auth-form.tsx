"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "./auth-provider";

const inputClass =
  "h-9 w-full rounded border border-border bg-background px-3 text-sm placeholder:text-muted focus:border-primary focus:outline-none";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const isRegister = mode === "register";
  const { user, loading, login, register } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    try {
      if (isRegister) await register(String(form.get("name")), email, password);
      else await login(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : err instanceof Error
            ? err.message
            : "Something went wrong",
      );
      setSubmitting(false);
    }
  }

  if (loading || user) return null;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface-1 p-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {isRegister ? "Create your account" : "Sign in to DevFlow"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {isRegister
            ? "Start planning and tracking delivery with your team."
            : "Welcome back."}
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          {isRegister && (
            <Field label="Name">
              <input
                name="name"
                required
                maxLength={100}
                autoComplete="name"
                className={inputClass}
              />
            </Field>
          )}
          <Field label="Email">
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className={inputClass}
            />
          </Field>
          <Field
            label="Password"
            hint={isRegister ? "At least 8 characters" : undefined}
          >
            <input
              name="password"
              type="password"
              required
              minLength={isRegister ? 8 : undefined}
              maxLength={72}
              autoComplete={isRegister ? "new-password" : "current-password"}
              className={inputClass}
            />
          </Field>

          {error && (
            <p
              role="alert"
              className="rounded border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="h-9 rounded bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
          >
            {submitting ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          {isRegister ? "Already have an account? " : "New to DevFlow? "}
          <Link
            href={isRegister ? "/login" : "/register"}
            className="text-primary hover:underline"
          >
            {isRegister ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}
