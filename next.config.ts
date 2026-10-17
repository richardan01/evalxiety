import type { NextConfig } from "next";

// Cache Components is intentionally OFF: AgentTrust is a local, fully dynamic review tool whose
// data lives in local JSON files and changes on every annotation. All data is fetched client-side
// from uncached route handlers, so prerendered shells add risk without benefit.
const nextConfig: NextConfig = {
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
