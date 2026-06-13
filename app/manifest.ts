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
    // Íconos opacos y cuadrados (el logo es claro → fondo azul de marca, si no en
    // Android/iOS quedaría casi invisible sobre fondo blanco/transparente).
    icons: [
      { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
