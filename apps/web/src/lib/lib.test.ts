import { afterEach, describe, expect, it, vi } from "vitest";
import { describeActivity } from "./activity";
import { api, ApiError } from "./api";
import { roleLabel } from "./roles";
import { formatDate, rankAt } from "./sprints";
import { priorityLabel } from "./tasks";
import { safeInternalPath, timeAgo } from "./time";
import { safeHttpsUrl } from "./url";

describe("timeAgo", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it.each([
    [10_000, "just now"],
    [5 * 60_000, "5m ago"],
    [3 * 3_600_000, "3h ago"],
    [2 * 86_400_000, "2d ago"],
  ])("formats %i ms as %s", (ms, text) => {
    expect(timeAgo(ago(ms), now)).toBe(text);
  });
  it("falls back to a date after a week", () => {
    expect(timeAgo(ago(20 * 86_400_000), now)).toMatch(/\d/);
  });
  it("never goes negative for timestamps slightly in the future", () => {
    expect(timeAgo(new Date(now + 5000).toISOString(), now)).toBe("just now");
  });
});

describe("safeInternalPath", () => {
  it("allows internal paths", () => {
    expect(safeInternalPath("/tasks/abc")).toBe("/tasks/abc");
    expect(safeInternalPath("/projects/1/backlog?x=1")).toBe(
      "/projects/1/backlog?x=1",
    );
  });
  it.each([
    "https://evil.com",
    "//evil.com",
    "javascript:alert(1)",
    "tasks/1",
    "",
  ])("refuses %j", (link) => {
    expect(safeInternalPath(link)).toBe("/dashboard");
  });
});

describe("rankAt (drag-and-drop ordering)", () => {
  it("starts at 1000 in an empty list", () => expect(rankAt([], 0)).toBe(1000));
  it("goes before the first item", () =>
    expect(rankAt([1000, 2000], 0)).toBe(0));
  it("goes after the last item", () =>
    expect(rankAt([1000, 2000], 2)).toBe(3000));
  it("goes between neighbours", () =>
    expect(rankAt([1000, 2000, 4000], 2)).toBe(3000));
  it("always sorts strictly between its neighbours", () => {
    const r = rankAt([10, 11], 1);
    expect(r).toBeGreaterThan(10);
    expect(r).toBeLessThan(11);
  });
});

describe("formatting helpers", () => {
  it("formats dates in UTC so a sprint's day never shifts", () => {
    expect(formatDate("2026-11-02T00:00:00.000Z")).toMatch(/2/);
    expect(formatDate("2026-11-02T00:00:00.000Z")).toBe(
      formatDate("2026-11-02T23:59:00.000Z"),
    );
  });
  it("labels roles and priorities", () => {
    expect(roleLabel("SCRUM_MASTER")).toBe("Scrum Master");
    expect(roleLabel("OWNER")).toBe("Owner");
    expect(priorityLabel("CRITICAL")).toBe("Critical");
  });
});

describe("describeActivity", () => {
  it("describes the common events", () => {
    expect(describeActivity("created", { status: "Backlog" })).toBe(
      "created this task in Backlog",
    );
    expect(
      describeActivity("status_changed", { from: "To Do", to: "Done" }),
    ).toBe("moved it from To Do to Done");
    expect(
      describeActivity("priority_changed", { from: "LOW", to: "HIGH" }),
    ).toBe("changed priority from LOW to HIGH");
    expect(describeActivity("blocked", { reason: "keys" })).toBe(
      "marked it blocked: keys",
    );
    expect(describeActivity("blocked", {})).toBe("marked it blocked");
    expect(describeActivity("unblocked", null)).toBe("unblocked it");
    expect(describeActivity("pr_linked", { number: 7 })).toBe(
      "linked pull request #7",
    );
    expect(describeActivity("pr_merged", { number: 7 })).toBe(
      "pull request #7 was merged",
    );
  });
  it("describes label changes", () => {
    expect(
      describeActivity("labels_changed", {
        added: ["bug", "ui"],
        removed: ["old"],
      }),
    ).toBe("labels: added bug, ui and removed old");
    expect(describeActivity("labels_changed", { added: ["bug"] })).toBe(
      "labels: added bug",
    );
  });
  it("names assignees when it can, and stays generic when it can't", () => {
    const names = new Map([
      ["a", "Ana"],
      ["b", "Ben"],
    ]);
    expect(describeActivity("assigned", { from: "a", to: "b" }, names)).toBe(
      "changed assignee from Ana to Ben",
    );
    expect(describeActivity("assigned", { from: null, to: "b" }, names)).toBe(
      "changed assignee from nobody to Ben",
    );
    expect(
      describeActivity("assigned", { from: "a", to: "zz" }, names),
    ).toContain("someone");
    expect(describeActivity("assigned", { to: "b" })).toBe("assigned it");
    expect(describeActivity("assigned", { to: null })).toBe("unassigned it");
  });
  it("handles sprint moves, updates and unknown types", () => {
    expect(
      describeActivity("sprint_changed", { from: null, to: "Sprint 1" }),
    ).toBe("moved it from the backlog to Sprint 1");
    expect(describeActivity("updated", { fields: ["title", "due date"] })).toBe(
      "updated title, due date",
    );
    expect(describeActivity("updated", null)).toBe("updated ");
    expect(describeActivity("something_new", null)).toBe("something_new");
  });
});

describe("api client", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    vi.restoreAllMocks();
  });
  const respond = (status: number, body?: unknown) =>
    vi.fn().mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
    );

  it("sends credentials, JSON and the bearer token", async () => {
    const fetchMock = respond(200, { ok: true });
    globalThis.fetch = fetchMock;
    await api("/things", { body: { a: 1 }, token: "tok" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/things$/);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ a: 1 }),
    });
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer tok",
    });
  });

  it("uses GET without a body and omits auth headers when there is no token", async () => {
    const fetchMock = respond(200, []);
    globalThis.fetch = fetchMock;
    await api("/list");
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("GET");
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("returns undefined for 204 responses", async () => {
    globalThis.fetch = respond(204);
    await expect(api("/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("raises ApiError with the server's message and status", async () => {
    globalThis.fetch = respond(409, { message: "Email is already registered" });
    await expect(api("/auth/register", { body: {} })).rejects.toMatchObject({
      name: "Error",
      status: 409,
      message: "Email is already registered",
    });
    await expect(api("/auth/register", { body: {} })).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("shows the first validation message when the server returns a list", async () => {
    globalThis.fetch = respond(400, {
      message: ["name must be longer", "other"],
    });
    await expect(api("/x", { body: {} })).rejects.toMatchObject({
      message: "name must be longer",
    });
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("<html>oops</html>", { status: 502 }));
    await expect(api("/x")).rejects.toMatchObject({
      status: 502,
      message: "Something went wrong",
    });
  });
});

describe("safeHttpsUrl", () => {
  it("keeps https links", () => {
    expect(safeHttpsUrl("https://github.com/acme/app/pull/7")).toBe(
      "https://github.com/acme/app/pull/7",
    );
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "http://insecure.example",
    "//evil.example",
    "not a url",
    "",
  ])("drops %j", (value) => {
    expect(safeHttpsUrl(value)).toBeUndefined();
  });
});
