import type { NextConfig } from "next";

// Cache Components is intentionally OFF: AgentTrust is a local, fully dynamic review tool whose
// data lives in local JSON files and changes on every annotation. All data is fetched client-side
// from uncached route handlers, so prerendered shells add risk without benefit.
// Approve, gold removal and rubric save are one or two clicks, so the app must not be framable by another site.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  experimental: {
    // Trace imports are JSON-encoded JSONL (quotes and newlines escaped); the 10 MB default would cut a 9 MB file short.
    proxyClientMaxBodySize: "25mb",
  },
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
