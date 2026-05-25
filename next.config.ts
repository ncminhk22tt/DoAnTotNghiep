import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: "/api/storage/:path*",
      },
    ];
  },
};

export default nextConfig;
