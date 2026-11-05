"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ErrorBox, inputClass, primaryButton } from "@/components/auth-card";
import { RequireAuth } from "@/components/require-auth";

export default function AccountPage() {
  return (
    <RequireAuth>
      <Account />
    </RequireAuth>
  );
}

function Account() {
  const { user, updateProfile, changePassword } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [profileMsg, setProfileMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<"profile" | "password" | null>(null);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setBusy("profile");
    try {
      await updateProfile(name);
      setProfileMsg({ ok: true, text: "Profile saved." });
    } catch (err) {
      setProfileMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Couldn't save",
      });
    } finally {
      setBusy(null);
    }
  }

  async function savePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPwMsg(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const next = String(data.get("next"));
    if (next !== String(data.get("confirm"))) {
      setPwMsg({ ok: false, text: "The new passwords don’t match." });
      return;
    }
    setBusy("password");
    try {
      await changePassword(String(data.get("current")), next);
      form.reset();
      setPwMsg({
        ok: true,
        text: "Password changed. You’ve been signed out on your other devices.",
      });
    } catch (err) {
      setPwMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Couldn't change password",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <Link
        href="/dashboard"
        className="text-sm text-muted hover:text-foreground"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Account</h1>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">Profile</h2>
        <form
          onSubmit={saveProfile}
          className="mt-3 flex flex-col gap-4 rounded-lg border border-border bg-surface-1 p-4"
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              autoComplete="name"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Email
            <input
              value={user?.email ?? ""}
              disabled
              className={`${inputClass} opacity-70`}
            />
            <span className="text-xs font-normal text-muted">
              Your email can’t be changed yet.
            </span>
          </label>
          {profileMsg &&
            (profileMsg.ok ? (
              <p role="status" className="text-sm text-success">
                {profileMsg.text}
              </p>
            ) : (
              <ErrorBox>{profileMsg.text}</ErrorBox>
            ))}
          <button
            disabled={
              busy !== null || !name.trim() || name.trim() === user?.name
            }
            className={`${primaryButton} w-fit`}
          >
            {busy === "profile" ? "Saving…" : "Save profile"}
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted">Change password</h2>
        <form
          onSubmit={savePassword}
          className="mt-3 flex flex-col gap-4 rounded-lg border border-border bg-surface-1 p-4"
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Current password
            <input
              name="current"
              type="password"
              required
              maxLength={72}
              autoComplete="current-password"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            New password
            <input
              name="next"
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
          {pwMsg &&
            (pwMsg.ok ? (
              <p role="status" className="text-sm text-success">
                {pwMsg.text}
              </p>
            ) : (
              <ErrorBox>{pwMsg.text}</ErrorBox>
            ))}
          <button disabled={busy !== null} className={`${primaryButton} w-fit`}>
            {busy === "password" ? "Changing…" : "Change password"}
          </button>
        </form>
      </section>
    </main>
  );
}
