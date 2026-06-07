"use client";

import { useState } from "react";
import { GraduationCap } from "lucide-react";
import Spinner from "@/components/Spinner";

interface LoginFormProps {
  onSuccess: () => void;
}

/** Login del web service de Sysacad: Legajo + DNI (Basic auth). */
export default function SysacadWsLogin({ onSuccess }: LoginFormProps) {
  const [legajo, setLegajo] = useState("");
  const [dni, setDni] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sysacadws/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legajo, dni, remember }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No se pudo iniciar sesión.");
        return;
      }
      onSuccess();
    } catch {
      setError("Error de conexión con Sysacad.");
    } finally {
      setLoading(false);
    }
  }

  const field =
    "login-input flex-1 py-3.5 text-sm text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none bg-transparent disabled:opacity-50";

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-[340px] flex flex-col gap-0">
      <div className="flex flex-col items-center text-center mb-6">
        <div className="w-16 h-16 rounded-[22px] bg-[var(--accent-light)] flex items-center justify-center mb-3 shadow-sm">
          <GraduationCap className="w-8 h-8 text-[#af52de]" />
        </div>
        <p className="text-xs font-semibold tracking-widest text-[var(--accent)] uppercase mb-1">UTN · Sysacad</p>
        <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Acceso a Sysacad</h2>
        <p className="text-sm text-[var(--secondary)] mt-0.5">Ingresá con tu legajo y DNI</p>
      </div>

      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] overflow-hidden mb-4 shadow-sm">
        <div className="flex items-center px-4 border-b border-[var(--separator)]">
          <label htmlFor="ws-legajo" className="text-sm font-medium text-[var(--fg)] w-20 shrink-0 py-3.5">Legajo</label>
          <input
            id="ws-legajo"
            type="text"
            inputMode="numeric"
            value={legajo}
            onChange={(e) => setLegajo(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="123456"
            required
            disabled={loading}
            autoComplete="username"
            className={field}
          />
        </div>
        <div className="flex items-center px-4">
          <label htmlFor="ws-dni" className="text-sm font-medium text-[var(--fg)] w-20 shrink-0 py-3.5">DNI</label>
          <input
            id="ws-dni"
            type="text"
            inputMode="numeric"
            value={dni}
            onChange={(e) => setDni(e.target.value.replace(/\D/g, "").slice(0, 9))}
            placeholder="12345678"
            required
            disabled={loading}
            autoComplete="off"
            className={field}
          />
        </div>
      </div>

      <label className="flex items-center gap-2.5 mb-4 px-1 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          disabled={loading}
          className="w-[18px] h-[18px] accent-[#007aff] rounded disabled:opacity-50"
        />
        <span className="text-[13px] text-[var(--fg)]">
          Mantener sesión iniciada en este dispositivo
        </span>
      </label>

      {error && <p className="text-[13px] text-[#ff3b30] text-center mb-4 px-2">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 disabled:opacity-60 transition-opacity shadow-sm flex items-center justify-center gap-2.5"
      >
        {loading ? (
          <>
            <Spinner size={18} color="#ffffff" />
            <span>Verificando…</span>
          </>
        ) : (
          "Ingresar"
        )}
      </button>

      <p className="text-[12px] text-[#aeaeb2] mt-6 text-center max-w-xs mx-auto leading-relaxed">
        Usamos tu DNI solo para autenticarte ante Sysacad. No se comparte con terceros.
      </p>
    </form>
  );
}
