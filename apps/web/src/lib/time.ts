/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** Server-composed links are internal paths; refuse anything else. */
export const safeInternalPath = (link: string) =>
  link.startsWith("/") && !link.startsWith("//") ? link : "/dashboard";
