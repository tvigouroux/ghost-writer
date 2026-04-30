import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@libsql/client", "simple-git"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" }, // audio uploads
  },
};

export default config;
