"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";

/**
 * El hub de Sysacad se unificó en /sysacad (web service + accesos por scraping).
 * Esta ruta queda como redirección para no romper enlaces viejos.
 */
export default function SysacadHubRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/sysacad");
  }, [router]);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />
    </div>
  );
}
