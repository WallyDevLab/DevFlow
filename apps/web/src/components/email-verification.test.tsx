import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: {
    user: null as {
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
    } | null,
    request: vi.fn(),
    reloadUser: vi.fn(),
  },
}));
vi.mock("./auth-provider", () => ({ useAuth: () => h.auth }));

import {
  EmailVerificationBanner,
  ResendVerification,
} from "./email-verification";

const user = (emailVerified: boolean) => ({
  id: "u1",
  name: "Ana",
  email: "ana@example.com",
  emailVerified,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.user = null;
  h.auth.request = vi.fn().mockResolvedValue(undefined);
  h.auth.reloadUser = vi.fn().mockResolvedValue(undefined);
});

describe("EmailVerificationBanner", () => {
  it("asks unverified users to confirm their address, naming it", () => {
    h.auth.user = user(false);
    render(<EmailVerificationBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/confirm your email/i);
    expect(screen.getByRole("status")).toHaveTextContent("ana@example.com");
    expect(screen.getByRole("status")).toHaveTextContent(/invitations/i);
  });

  it("is hidden for verified users and for visitors who aren't signed in", () => {
    h.auth.user = user(true);
    const { container, rerender } = render(<EmailVerificationBanner />);
    expect(container).toBeEmptyDOMElement();
    h.auth.user = null;
    rerender(<EmailVerificationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("re-checks the account when the tab regains focus (the link may have been clicked elsewhere)", async () => {
    h.auth.user = user(false);
    render(<EmailVerificationBanner />);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(h.auth.reloadUser).toHaveBeenCalledTimes(1));
  });

  it("doesn't poll for verified users", () => {
    h.auth.user = user(true);
    render(<EmailVerificationBanner />);
    window.dispatchEvent(new Event("focus"));
    expect(h.auth.reloadUser).not.toHaveBeenCalled();
  });

  it("survives a failed re-check", async () => {
    h.auth.user = user(false);
    h.auth.reloadUser.mockRejectedValue(new Error("offline"));
    render(<EmailVerificationBanner />);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(h.auth.reloadUser).toHaveBeenCalled());
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("ResendVerification", () => {
  it("requests a new link and confirms", async () => {
    render(<ResendVerification />);
    await userEvent.click(screen.getByRole("button", { name: "Resend link" }));
    expect(h.auth.request).toHaveBeenCalledWith("/auth/resend-verification", {
      method: "POST",
    });
    expect(await screen.findByText(/link sent/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables the button while sending", async () => {
    let finish!: () => void;
    h.auth.request.mockReturnValue(new Promise<void>((r) => (finish = r)));
    render(<ResendVerification />);
    await userEvent.click(screen.getByRole("button", { name: "Resend link" }));
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    finish();
    expect(await screen.findByText(/link sent/i)).toBeInTheDocument();
  });

  it("shows the error and lets you try again", async () => {
    h.auth.request.mockRejectedValueOnce(new Error("Too many requests"));
    render(<ResendVerification />);
    await userEvent.click(screen.getByRole("button", { name: "Resend link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests",
    );
    await userEvent.click(screen.getByRole("button", { name: "Resend link" }));
    expect(await screen.findByText(/link sent/i)).toBeInTheDocument();
  });
});
