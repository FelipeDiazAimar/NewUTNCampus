import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import GuestBlockModal from "@/components/GuestBlockModal";

export const metadata: Metadata = {
  title: "Campus UTN FRSF",
  description: "Campus Virtual - UTN Facultad Regional San Francisco",
  // El apple-touch-icon lo provee app/apple-icon.png (opaco y cuadrado, requisito
  // de iOS). Acá solo el favicon de la pestaña del navegador.
  icons: {
    icon: "/logo.png",
  },
  // iOS: lanzar en pantalla completa (standalone) y título bajo el ícono.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Campus UTN",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning is required: next-themes writes the theme class
    // server-side which differs from the client until JS runs.
    <html lang="es" className="h-full" suppressHydrationWarning>
      <body className="min-h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange={false}
        >
          {children}
          <GuestBlockModal />
        </ThemeProvider>
      </body>
    </html>
  );
}
