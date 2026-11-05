import type { ReactNode } from "react";

/** Centered card used by the sign-in / reset style pages. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface-1 p-6">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export const inputClass =
  "h-9 w-full rounded border border-border bg-background px-3 text-sm placeholder:text-muted focus:border-primary focus:outline-none";

export const primaryButton =
  "h-9 rounded bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60";

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
    >
      {children}
    </p>
  );
}
