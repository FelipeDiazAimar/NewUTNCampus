import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  turbopack: {},
  serverExternalPackages: ["googleapis"],
  async redirects() {
    return [
      {
        source: "/course/:id",
        destination: "/materia/:id",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
