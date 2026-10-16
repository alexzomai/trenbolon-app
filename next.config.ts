import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal server.js, which is what the
  // Dockerfile copies into the runtime stage.
  output: "standalone",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
