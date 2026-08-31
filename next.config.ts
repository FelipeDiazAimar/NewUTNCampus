import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  turbopack: {},
  // El type check en build tardaba más que la compilación entera (árbol de
  // deps pesado). Gate explícito: `npm run typecheck`. El build solo compila
  // (en Next 16 el lint ya no corre durante el build).
  typescript: { ignoreBuildErrors: true },
  // Paquetes con binarios/dinámica que Next no debe empaquetar en el bundle
  // serverless (Chromium descomprimido en /tmp, ws nativo, etc).
  serverExternalPackages: ["googleapis", "playwright-core", "@sparticuz/chromium", "ws"],
  // playwright-core requiere browsers.json y assets dinámicos en runtime; el
  // file tracing (nft) no sigue el require de ruta computada en coreBundle.js
  // y los poda => "Cannot find module .../browsers.json". Con Turbopack la
  // clave específica no alcanzó (issues vercel/next.js#89207, vercel/vercel#15654):
  // se usa clave global + específicas, cubriendo los formatos de clave que
  // documentan App Router ("/api/captcha" y "/api/captcha/route").
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/playwright-core/**/*",
      "./node_modules/@sparticuz/**/*",
    ],
    "/api/captcha": [
      "./node_modules/playwright-core/**/*",
      "./node_modules/@sparticuz/**/*",
    ],
    "/api/captcha/route": [
      "./node_modules/playwright-core/**/*",
      "./node_modules/@sparticuz/**/*",
    ],
  },
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
