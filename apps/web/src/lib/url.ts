/**
 * Links that come from outside (for example a pull request URL reported by
 * GitHub) are only rendered as https links, so a crafted value like
 * "javascript:..." can never become a clickable href.
 */
export function safeHttpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
