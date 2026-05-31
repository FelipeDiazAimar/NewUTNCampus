import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campus UTN FRSF",
  description: "Campus Virtual - UTN Facultad Regional San Francisco",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="h-full">
      <body className="min-h-full bg-slate-50">{children}</body>
    </html>
  );
}
