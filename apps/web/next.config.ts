import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Browsers may call the API at this origin (and only it).
const apiOrigin = (() => {
  try {
    return new URL(
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1",
    ).origin;
  } catch {
    return "";
  }
})();

// Content-Security-Policy. Next.js injects small inline bootstrap scripts, so
// script-src needs 'unsafe-inline' until the app moves to nonce-based CSP; the
// rest of the policy still blocks foreign scripts, framing, plugins and form
// posts to other sites. It is applied to production builds only, because the
// dev server needs eval and websockets for hot reload.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Invite and reset links carry one-time tokens in the URL; never send them
  // to other sites in the Referer header.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  ...(isProd
    ? [
        { key: "Content-Security-Policy", value: csp },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Lets a build write somewhere other than .next (for example to check a
  // production build without disturbing a running `next dev`).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Don't advertise the framework.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
