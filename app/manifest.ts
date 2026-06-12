import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Campus UTN FRSF",
    short_name: "Campus UTN",
    description: "Campus Virtual PWA de UTN Facultad Regional San Francisco",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#007aff",
    icons: [
      {
        src: "/logo.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/logo.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/logo.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/logo.png",
        sizes: "2048x2048",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/logo.png",
        sizes: "2048x2048",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
