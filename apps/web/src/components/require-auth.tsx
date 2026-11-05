"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./auth-provider";

/**
 * Renders children only for signed-in users; others go to /login and come
 * back afterwards. `keepSearch` carries the query string (e.g. invite tokens).
 */
export function RequireAuth({
  children,
  keepSearch = false,
}: {
  children: React.ReactNode;
  keepSearch?: boolean;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      // Read at runtime (not via usePathname) so pages can still prerender.
      const { pathname, search } = window.location;
      const target = pathname + (keepSearch ? search : "");
      router.replace(`/login?next=${encodeURIComponent(target)}`);
    }
  }, [loading, user, router, keepSearch]);

  if (loading || !user) return null;
  return <>{children}</>;
}
