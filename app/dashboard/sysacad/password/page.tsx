"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import Spinner from "@/components/Spinner";

export default function CambioPasswordPage() {
  const router = useRouter();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) router.push("/");
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (nueva !== repetir) {
      setMsg({ ok: false, text: "La nueva contraseña no coincide." });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/sysacadws/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual, nueva, repetir }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/sysacad");
          return;
        }
        setMsg({ ok: false, text: json.error ?? json.mensaje ?? "No se pudo cambiar la contraseña." });
        return;
      }
      setMsg({ ok: true, text: json.mensaje ?? "Contraseña actualizada." });
      setActual("");
      setNueva("");
      setRepetir("");
    } catch {
      setMsg({ ok: false, text: "Error de conexión con Sysacad." });
    } finally {
      setLoading(false);
    }
  }

  const field =
    "login-input w-full py-3.5 px-4 text-sm text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none bg-transparent disabled:opacity-50";

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />

      <main className="max-w-xl mx-auto px-4 pt-20 pb-12">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Sysacad", href: "/sysacad" },
            { label: "Cambiar contraseña" },
          ]}
        />

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm bg-[#8e8e931a] text-[#8e8e93]">
            <KeyRound className="w-6 h-6" />
          </div>
          <h1 className="text-[24px] font-bold text-[var(--fg)] tracking-tight">
            Cambiar contraseña
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-0">
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] overflow-hidden shadow-sm mb-4">
            <input
              type="password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              placeholder="Contraseña actual"
              maxLength={12}
              required
              disabled={loading}
              autoComplete="current-password"
              className={`${field} border-b border-[var(--separator)]`}
            />
            <input
              type="password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              placeholder="Nueva contraseña"
              maxLength={12}
              required
              disabled={loading}
              autoComplete="new-password"
              className={`${field} border-b border-[var(--separator)]`}
            />
            <input
              type="password"
              value={repetir}
              onChange={(e) => setRepetir(e.target.value)}
              placeholder="Repetir nueva contraseña"
              maxLength={12}
              required
              disabled={loading}
              autoComplete="new-password"
              className={field}
            />
          </div>

          {msg && (
            <p
              className={`text-[13px] text-center mb-4 px-2 ${
                msg.ok ? "text-[#34c759]" : "text-[#ff3b30]"
              }`}
            >
              {msg.text}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 disabled:opacity-60 transition-opacity shadow-sm flex items-center justify-center gap-2.5"
          >
            {loading ? (
              <>
                <Spinner size={18} color="#ffffff" />
                <span>Cambiando…</span>
              </>
            ) : (
              "Cambiar contraseña"
            )}
          </button>
        </form>

        <p className="text-[12px] text-[#aeaeb2] mt-6 text-center max-w-xs mx-auto leading-relaxed">
          La contraseña puede tener hasta 12 caracteres.
        </p>
      </main>
    </div>
  );
}
