import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Cursor SDK is a Node-only dependency used server-side by the /ops
  // incident orchestrator. Keep it out of the bundler (matches crew-app and
  // factory) so Turbopack does not try to process its bundled assets.
  serverExternalPackages: ["@cursor/sdk"],
};

export default nextConfig;
