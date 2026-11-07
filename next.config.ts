import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Agent SDK starts the Claude Code program in a separate process.
  // Tell Next.js to load the package as-is instead of bundling it.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
