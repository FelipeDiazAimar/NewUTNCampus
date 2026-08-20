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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Send our own path to same-origin/HTTPS links, but never leak it in the
          // Referer header to a third-party site an outbound link (e.g. inside a
          // proxied Moodle page) might point to.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
