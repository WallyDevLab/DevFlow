/** Plain-language description of a task history event. Shared by the task page and the activity feed. */
export function describeActivity(
  type: string,
  data: Record<string, unknown> | null,
  names?: Map<string, string>,
): string {
  const d = data ?? {};
  const who = (id: unknown) =>
    id ? (names?.get(String(id)) ?? "someone") : "nobody";
  switch (type) {
    case "created":
      return `created this task in ${d.status}`;
    case "status_changed":
      return `moved it from ${d.from} to ${d.to}`;
    case "priority_changed":
      return `changed priority from ${d.from} to ${d.to}`;
    case "assigned":
      return names
        ? `changed assignee from ${who(d.from)} to ${who(d.to)}`
        : d.to
          ? "assigned it"
          : "unassigned it";
    case "blocked":
      return d.reason ? `marked it blocked: ${d.reason}` : "marked it blocked";
    case "unblocked":
      return "unblocked it";
    case "labels_changed": {
      const added = (d.added as string[] | undefined) ?? [];
      const removed = (d.removed as string[] | undefined) ?? [];
      return (
        "labels: " +
        [
          added.length ? `added ${added.join(", ")}` : "",
          removed.length ? `removed ${removed.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" and ")
      );
    }
    case "sprint_changed":
      return `moved it from ${d.from ?? "the backlog"} to ${d.to ?? "the backlog"}`;
    case "pr_linked":
      return `linked pull request #${d.number}`;
    case "pr_merged":
      return `pull request #${d.number} was merged`;
    case "updated":
      return `updated ${((d.fields as string[] | undefined) ?? []).join(", ")}`;
    default:
      return type;
  }
}
