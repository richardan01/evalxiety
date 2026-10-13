import type { NextConfig } from "next";

// Cache Components is intentionally OFF: AgentTrust is a local, fully dynamic review tool whose
// data lives in local JSON files and changes on every annotation. All data is fetched client-side
// from uncached route handlers, so prerendered shells add risk without benefit.
const nextConfig: NextConfig = {
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
