import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <span className="w-fit rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
        DEV-001
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">DevFlow</h1>
      <p className="text-muted">
        Plan, track and analyse software delivery, connected to your GitHub
        activity.
      </p>
      <div className="flex gap-3">
        <Link
          href="/register"
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98]"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-2"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
