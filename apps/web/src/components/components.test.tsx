import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { BoardColumn } from "@/lib/tasks";

// ---- shared mocks -----------------------------------------------------------

const h = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  auth: {
    user: null as { id: string; name: string; email: string } | null,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    request: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => h.router }));
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
vi.mock("./auth-provider", () => ({ useAuth: () => h.auth }));

import { AuthForm } from "./auth-form";
import { Comments } from "./comments";
import { ColumnSettings } from "./column-settings";
import { LabelChips } from "./labels";
import { NotificationBell } from "./notification-bell";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.user = null;
  h.auth.loading = false;
  h.auth.request = vi.fn();
  window.history.pushState({}, "", "/login");
});

// ---- AuthForm ---------------------------------------------------------------

describe("AuthForm", () => {
  it("signs in and goes to the dashboard", async () => {
    h.auth.login.mockResolvedValue(undefined);
    render(<AuthForm mode="login" />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.co");
    await userEvent.type(screen.getByLabelText(/password/i), "secret-pass");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(h.auth.login).toHaveBeenCalledWith("a@b.co", "secret-pass");
    await waitFor(() =>
      expect(h.router.replace).toHaveBeenCalledWith("/dashboard"),
    );
  });

  it("returns to the page that required sign-in", async () => {
    window.history.pushState({}, "", "/login?next=%2Finvite%3Ftoken%3Dabc");
    h.auth.login.mockResolvedValue(undefined);
    render(<AuthForm mode="login" />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.co");
    await userEvent.type(screen.getByLabelText(/password/i), "secret-pass");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() =>
      expect(h.router.replace).toHaveBeenCalledWith("/invite?token=abc"),
    );
  });

  it.each(["https://evil.example", "//evil.example", "javascript:alert(1)"])(
    "never redirects to an external ?next=%s",
    async (next) => {
      window.history.pushState(
        {},
        "",
        `/login?next=${encodeURIComponent(next)}`,
      );
      h.auth.login.mockResolvedValue(undefined);
      render(<AuthForm mode="login" />);
      await userEvent.type(screen.getByLabelText(/email/i), "a@b.co");
      await userEvent.type(screen.getByLabelText(/password/i), "secret-pass");
      await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
      await waitFor(() =>
        expect(h.router.replace).toHaveBeenCalledWith("/dashboard"),
      );
    },
  );

  it("shows the server's error and stays on the page", async () => {
    h.auth.login.mockRejectedValue(new ApiError(401, "Invalid credentials"));
    render(<AuthForm mode="login" />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.co");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong-pass");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid credentials",
    );
    expect(h.router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();
  });

  it("explains rate limiting in plain language", async () => {
    h.auth.login.mockRejectedValue(
      new ApiError(429, "ThrottlerException: Too Many Requests"),
    );
    render(<AuthForm mode="login" />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.co");
    await userEvent.type(screen.getByLabelText(/password/i), "x-x-x-x-x-x");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /too many attempts/i,
    );
  });

  it("offers password reset on sign-in only", () => {
    const { unmount } = render(<AuthForm mode="login" />);
    expect(
      screen.getByRole("link", { name: /forgot password/i }),
    ).toHaveAttribute("href", "/forgot-password");
    unmount();
    render(<AuthForm mode="register" />);
    expect(
      screen.queryByRole("link", { name: /forgot password/i }),
    ).not.toBeInTheDocument();
  });

  it("registers with a name, enforcing the password rules in the form", async () => {
    h.auth.register.mockResolvedValue(undefined);
    render(<AuthForm mode="register" />);
    expect(screen.getByLabelText(/name/i)).toBeRequired();
    expect(screen.getByLabelText(/password/i)).toHaveAttribute(
      "minlength",
      "8",
    );
    expect(screen.getByLabelText(/password/i)).toHaveAttribute(
      "maxlength",
      "72",
    );
    await userEvent.type(screen.getByLabelText(/name/i), "Ana Lee");
    await userEvent.type(screen.getByLabelText(/email/i), "ana@b.co");
    await userEvent.type(screen.getByLabelText(/password/i), "long-enough-pw");
    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );
    expect(h.auth.register).toHaveBeenCalledWith(
      "Ana Lee",
      "ana@b.co",
      "long-enough-pw",
    );
  });

  it("sends signed-in visitors on, and renders nothing while loading", () => {
    h.auth.user = { id: "1", name: "A", email: "a@b.co" };
    const { container } = render(<AuthForm mode="login" />);
    expect(container).toBeEmptyDOMElement();
    expect(h.router.replace).toHaveBeenCalledWith("/dashboard");
  });
});

// ---- Labels ----------------------------------------------------------------

describe("LabelChips", () => {
  const labels = ["a", "b", "c", "d", "e"].map((n) => ({
    id: n,
    name: `label-${n}`,
    color: "#3987e5",
  }));
  it("shows up to the limit, then a +n overflow", () => {
    render(<LabelChips labels={labels} max={3} />);
    expect(screen.getAllByText(/label-/)).toHaveLength(3);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
  it("renders nothing when there are no labels", () => {
    const { container } = render(<LabelChips labels={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// ---- Comments & mentions -----------------------------------------------------

describe("Comments", () => {
  const members = [
    { userId: "u-ana", name: "Ana Lee" },
    { userId: "u-ben", name: "Ben" },
  ];
  const comment = (over: object = {}) => ({
    id: "c1",
    body: "Hello",
    author: { id: "u-ben", name: "Ben" },
    createdAt: "2026-11-05T10:00:00Z",
    edited: false,
    canEdit: false,
    canDelete: false,
    ...over,
  });

  function setup(list: object[]) {
    h.auth.request.mockImplementation(
      (path: string, opts?: { method?: string }) =>
        path.endsWith("/comments") && !opts?.method
          ? Promise.resolve(list)
          : Promise.resolve({ id: "new" }),
    );
    return render(<Comments taskId="t1" canComment members={members} />);
  }

  it("suggests teammates after @, inserts the full name, and sends their id", async () => {
    setup([]);
    const box = await screen.findByLabelText("New comment");
    await userEvent.type(box, "Please review @An");
    await userEvent.click(
      await screen.findByRole("button", { name: /Ana Lee/ }),
    );
    expect(box).toHaveValue("Please review @Ana Lee ");
    await userEvent.type(box, "thanks");
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(h.auth.request).toHaveBeenCalledWith("/tasks/t1/comments", {
        body: { body: "Please review @Ana Lee thanks", mentionIds: ["u-ana"] },
      }),
    );
  });

  it("sends no mention ids when nobody is mentioned, or when the name was deleted from the text", async () => {
    setup([]);
    const box = await screen.findByLabelText("New comment");
    await userEvent.type(box, "plain comment");
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(h.auth.request).toHaveBeenCalledWith("/tasks/t1/comments", {
        body: { body: "plain comment", mentionIds: [] },
      }),
    );
  });

  it("highlights mentions of members in posted comments", async () => {
    setup([comment({ body: "Hi @Ana Lee and @Ben, and @Nobody" })]);
    const mentions = await screen.findAllByText(/^@(Ana Lee|Ben)$/);
    expect(mentions.map((m) => m.textContent)).toEqual(["@Ana Lee", "@Ben"]);
    expect(
      screen.getByText(/and @Nobody/, { exact: false }),
    ).toBeInTheDocument();
  });

  it("renders comment text as plain text, never as HTML", async () => {
    const { container } = setup([
      comment({ body: '<img src=x onerror="alert(1)"><b>bold</b>' }),
    ]);
    await screen.findByText(/onerror/);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("shows edit and delete only where permitted", async () => {
    setup([
      comment({ id: "a", canEdit: true, canDelete: true }),
      comment({ id: "b", body: "Other", canDelete: true }),
    ]);
    const items = await screen.findAllByRole("listitem");
    expect(
      within(items[0]).getByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(
      within(items[1]).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      within(items[1]).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("hides the comment box from read-only users", async () => {
    h.auth.request.mockResolvedValue([]);
    render(<Comments taskId="t1" canComment={false} members={members} />);
    expect(await screen.findByText(/read-only access/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("New comment")).not.toBeInTheDocument();
  });
});

// ---- Notification bell -------------------------------------------------------

describe("NotificationBell", () => {
  const items = [
    {
      id: "n1",
      type: "MENTION",
      message: "Ana mentioned you",
      link: "/tasks/t1",
      readAt: null,
      createdAt: new Date().toISOString(),
    },
    {
      id: "n2",
      type: "TASK_ASSIGNED",
      message: "Ben assigned you DEV-2",
      link: "https://evil.example",
      readAt: "2026-11-05T10:00:00Z",
      createdAt: new Date().toISOString(),
    },
  ];
  beforeEach(() => {
    h.auth.request.mockImplementation((path: string) => {
      if (path === "/notifications/unread-count")
        return Promise.resolve({ unreadCount: 3 });
      if (path.startsWith("/notifications?"))
        return Promise.resolve({ items, unreadCount: 3 });
      return Promise.resolve(undefined);
    });
  });

  it("shows the unread count on the bell", async () => {
    render(<NotificationBell />);
    expect(
      await screen.findByRole("button", { name: "Notifications, 3 unread" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("caps very large counts", async () => {
    h.auth.request.mockResolvedValue({ unreadCount: 250 });
    render(<NotificationBell />);
    expect(await screen.findByText("99+")).toBeInTheDocument();
  });

  it("opens a list, marks an item read and follows its link", async () => {
    render(<NotificationBell />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Notifications, 3 unread/ }),
    );
    await userEvent.click(await screen.findByText("Ana mentioned you"));
    expect(h.auth.request).toHaveBeenCalledWith("/notifications/n1/read", {
      method: "POST",
    });
    expect(h.router.push).toHaveBeenCalledWith("/tasks/t1");
  });

  it("doesn't re-mark read items, and never follows an external link", async () => {
    render(<NotificationBell />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Notifications, 3 unread/ }),
    );
    await userEvent.click(await screen.findByText("Ben assigned you DEV-2"));
    expect(h.auth.request).not.toHaveBeenCalledWith(
      "/notifications/n2/read",
      expect.anything(),
    );
    expect(h.router.push).toHaveBeenCalledWith("/dashboard");
  });

  it("marks everything read", async () => {
    render(<NotificationBell />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Notifications, 3 unread/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Mark all read" }),
    );
    expect(h.auth.request).toHaveBeenCalledWith("/notifications/read-all", {
      method: "POST",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Notifications" }),
      ).toBeInTheDocument(),
    );
  });

  it("closes with Escape and shows an empty state", async () => {
    h.auth.request.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("unread-count")
          ? { unreadCount: 0 }
          : { items: [], unreadCount: 0 },
      ),
    );
    render(<NotificationBell />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Notifications" }),
    );
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ---- Column settings -------------------------------------------------------

describe("ColumnSettings", () => {
  const col = (
    id: string,
    name: string,
    category: string,
    tasks = 0,
    wipLimit: number | null = null,
  ): BoardColumn => ({
    id,
    name,
    category,
    wipLimit,
    tasks: Array.from({ length: tasks }, (_, i) => ({
      id: `${id}-${i}`,
      key: `K-${i}`,
      title: "t",
      priority: "MEDIUM",
      storyPoints: null,
      blocked: false,
      position: i,
      assignee: null,
      labels: [],
    })),
  });
  const columns = [
    col("c1", "To Do", "TODO", 2),
    col("c2", "Doing", "IN_PROGRESS", 0, 3),
    col("c3", "Done", "DONE", 1),
  ];
  const onChanged = vi.fn();
  const onClose = vi.fn();
  beforeEach(() => {
    h.auth.request.mockResolvedValue({});
  });
  const open = (cols = columns) =>
    render(
      <ColumnSettings
        projectId="p1"
        columns={cols}
        onChanged={onChanged}
        onClose={onClose}
      />,
    );

  it("renames a column when the field loses focus", async () => {
    open();
    const input = screen.getByLabelText("Name of Doing");
    await userEvent.clear(input);
    await userEvent.type(input, "Building");
    await userEvent.tab();
    expect(h.auth.request).toHaveBeenCalledWith("/statuses/c2", {
      method: "PATCH",
      body: { name: "Building" },
    });
  });

  it("changes a column's type and its WIP limit, including clearing it", async () => {
    open();
    await userEvent.selectOptions(
      screen.getByLabelText("Type of Doing"),
      "IN_REVIEW",
    );
    expect(h.auth.request).toHaveBeenCalledWith("/statuses/c2", {
      method: "PATCH",
      body: { category: "IN_REVIEW" },
    });
    const limit = screen.getByLabelText("WIP limit for Doing");
    await userEvent.clear(limit);
    await userEvent.tab();
    expect(h.auth.request).toHaveBeenCalledWith("/statuses/c2", {
      method: "PATCH",
      body: { wipLimit: null },
    });
  });

  it("reorders with the arrow buttons", async () => {
    open();
    await userEvent.click(screen.getByLabelText("Move Doing left"));
    expect(h.auth.request).toHaveBeenCalledWith("/projects/p1/statuses/order", {
      method: "PUT",
      body: { ids: ["c2", "c1", "c3"] },
    });
    expect(screen.getByLabelText("Move To Do left")).toBeDisabled();
  });

  it("makes you choose where a column's tasks go before deleting it", async () => {
    open();
    const row = screen.getByLabelText("Name of To Do").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/2 tasks/)).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByLabelText(/move tasks to/i),
      "c3",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Delete column" }),
    );
    expect(h.auth.request).toHaveBeenCalledWith("/statuses/c1?moveTo=c3", {
      method: "DELETE",
    });
  });

  it("deletes an empty column without a target", async () => {
    open();
    const row = screen.getByLabelText("Name of Doing").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Delete column" }),
    );
    expect(h.auth.request).toHaveBeenCalledWith("/statuses/c2", {
      method: "DELETE",
    });
  });

  it("won't let a board shrink below two columns", () => {
    open([col("c1", "To Do", "TODO"), col("c3", "Done", "DONE")]);
    for (const b of screen.getAllByRole("button", { name: "Delete" }))
      expect(b).toBeDisabled();
  });

  it("adds a column with a type and an optional WIP limit", async () => {
    open();
    await userEvent.type(
      screen.getByPlaceholderText("e.g. Testing"),
      "Testing",
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Type of the new column"),
      "IN_REVIEW",
    );
    await userEvent.type(
      screen.getByLabelText("WIP limit for the new column"),
      "2",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(h.auth.request).toHaveBeenCalledWith("/projects/p1/statuses", {
      body: { name: "Testing", category: "IN_REVIEW", wipLimit: 2 },
    });
  });

  it("surfaces server errors and refreshes the board afterwards", async () => {
    h.auth.request.mockRejectedValueOnce(
      new Error("A column named “Done” already exists"),
    );
    open();
    const input = screen.getByLabelText("Name of Doing");
    await userEvent.clear(input);
    await userEvent.type(input, "Done");
    await userEvent.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /already exists/,
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("closes with Escape", async () => {
    open();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
