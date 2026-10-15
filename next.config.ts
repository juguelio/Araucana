import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/reservas/:code", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/api/v1/reservations/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store" }] }
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb"
    }
  },
  turbopack: {
    root: projectRoot
  }
};

export default nextConfig;
