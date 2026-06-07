"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import SysacadWidget, { type SysacadCredentials } from "@/components/SysacadWidget";

export default function SysacadLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Debe estar logueado en el campus primero.
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    // Si ya hay sesión de Sysacad, saltar directo al hub.
    if (document.cookie.includes("sysacad_user")) {
      router.replace("/sysacad");
      return;
    }
    setReady(true);
  }, [router]);

  async function handleLogin(creds: SysacadCredentials) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sysacad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creds),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No se pudo iniciar sesión.");
        return;
      }
      router.push("/sysacad");
    } catch {
      setError("Error de conexión con Sysacad.");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <Navbar />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />
      <main className="max-w-xl mx-auto px-4 pt-20 pb-12">
        <Breadcrumb
          items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sysacad" }]}
        />
        <div className="flex flex-col items-center pt-4">
          <SysacadWidget onSubmit={handleLogin} loading={loading} error={error} />
        </div>
      </main>
    </div>
  );
}
