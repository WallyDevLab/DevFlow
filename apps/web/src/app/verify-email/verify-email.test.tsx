import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const h = vi.hoisted(() => ({
  api: vi.fn(),
  auth: {
    user: null as {
      id: string;
      email: string;
      name: string;
      emailVerified: boolean;
    } | null,
    loading: false,
    request: vi.fn(),
    reloadUser: vi.fn(),
  },
}));

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: h.api,
}));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => h.auth }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import VerifyEmailPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.user = null;
  h.auth.loading = false;
  h.auth.request = vi.fn().mockResolvedValue(undefined);
  h.auth.reloadUser = vi.fn().mockResolvedValue(undefined);
  window.history.pushState({}, "", "/verify-email?token=abc123");
});

describe("verify-email page", () => {
  it("submits the token from the link and confirms", async () => {
    h.api.mockResolvedValue(undefined);
    render(<VerifyEmailPage />);
    expect(
      await screen.findByRole("heading", { name: /email confirmed/i }),
    ).toBeInTheDocument();
    expect(h.api).toHaveBeenCalledWith("/auth/verify-email", {
      body: { token: "abc123" },
    });
  });

  it("uses the one-time link exactly once, even when React runs effects twice", async () => {
    h.api.mockResolvedValue(undefined);
    render(
      <StrictMode>
        <VerifyEmailPage />
      </StrictMode>,
    );
    await screen.findByRole("heading", { name: /email confirmed/i });
    expect(h.api).toHaveBeenCalledTimes(1);
  });

  it("refreshes a signed-in user so the banner disappears", async () => {
    h.auth.user = { id: "1", email: "a@b.co", name: "A", emailVerified: false };
    h.api.mockResolvedValue(undefined);
    render(<VerifyEmailPage />);
    await waitFor(() => expect(h.auth.reloadUser).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("sends signed-out visitors to sign in afterwards", async () => {
    h.api.mockResolvedValue(undefined);
    render(<VerifyEmailPage />);
    expect(
      await screen.findByRole("link", { name: /sign in/i }),
    ).toHaveAttribute("href", "/login");
  });

  it("explains a bad or expired link and offers a new one when signed in", async () => {
    h.auth.user = { id: "1", email: "a@b.co", name: "A", emailVerified: false };
    h.api.mockRejectedValue(
      new ApiError(400, "This verification link is invalid or has expired"),
    );
    render(<VerifyEmailPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /invalid or has expired/i,
    );
    expect(
      screen.getByRole("button", { name: "Resend link" }),
    ).toBeInTheDocument();
  });

  it("asks signed-out visitors to sign in to request a new link", async () => {
    h.api.mockRejectedValue(
      new ApiError(400, "This verification link is invalid or has expired"),
    );
    render(<VerifyEmailPage />);
    await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(
      screen.queryByRole("button", { name: "Resend link" }),
    ).not.toBeInTheDocument();
  });

  it("doesn't call the server when the link has no token", async () => {
    window.history.pushState({}, "", "/verify-email");
    render(<VerifyEmailPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /missing its verification code/i,
    );
    expect(h.api).not.toHaveBeenCalled();
  });
});
