import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Campus UTN FRSF",
  description: "Campus Virtual - UTN Facultad Regional San Francisco",
  icons: {
    // Ícono de la pestaña del navegador
    icon: "/logo.png",
    // Ícono que usa iOS al agregar a la pantalla de inicio (sin efecto gloss)
    apple: [{ url: "/logo.png", sizes: "2048x2048", type: "image/png" }],
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
        </ThemeProvider>
      </body>
    </html>
  );
}
