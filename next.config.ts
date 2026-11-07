import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Agent SDK starts the Claude Code program in a separate process.
  // Tell Next.js to load the package as-is instead of bundling it.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],

  experimental: {
    serverActions: {
      // Server Actions accept 1 MB by default. Receipt photos can be up to
      // 4 MB (checked in app/actions.ts), plus some room for the other fields.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
