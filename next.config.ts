import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async redirects() {
    return [
      {
        source: "/services",
        destination: "/dich-vu",
        permanent: true,
      },
      {
        source: "/doctors",
        destination: "/bac-si",
        permanent: true,
      },
    ];
  },
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
