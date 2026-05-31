"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (document.cookie.includes("moodle_user")) router.push("/dashboard");
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Error desconocido");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
      {/* Logo */}
      <div className="mb-10 flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-[22px] bg-[#e8f4fd] flex items-center justify-center shadow-sm">
          <svg
            className="w-8 h-8 text-[#007aff]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-xs font-semibold tracking-widest text-[#007aff] uppercase mb-1">
            UTN · FRSF
          </p>
          <h1 className="text-[28px] font-bold text-[#1c1c1e] tracking-tight">
            Campus Virtual
          </h1>
          <p className="text-sm text-[#6c6c70] mt-0.5">
            Facultad Regional San Francisco
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleLogin} className="w-full max-w-[340px] flex flex-col gap-0">
        {/* Inputs group — iOS grouped style */}
        <div className="bg-white rounded-2xl border border-[rgba(60,60,67,0.18)] overflow-hidden mb-4 shadow-sm">
          <div className="flex items-center px-4 py-0 border-b border-[rgba(60,60,67,0.1)]">
            <label className="text-sm font-medium text-[#1c1c1e] w-24 shrink-0 py-3.5">
              Usuario
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="tu.nombre"
              required
              autoCapitalize="none"
              autoCorrect="off"
              className="flex-1 py-3.5 text-sm text-[#1c1c1e] placeholder:text-[#c7c7cc] outline-none bg-transparent"
            />
          </div>
          <div className="flex items-center px-4 py-0">
            <label className="text-sm font-medium text-[#1c1c1e] w-24 shrink-0 py-3.5">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="flex-1 py-3.5 text-sm text-[#1c1c1e] placeholder:text-[#c7c7cc] outline-none bg-transparent"
            />
          </div>
        </div>

        {error && (
          <p className="text-[13px] text-[#ff3b30] text-center mb-4 px-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 disabled:opacity-50 transition-opacity shadow-sm"
        >
          {loading ? "Ingresando…" : "Ingresar"}
        </button>
      </form>

      <p className="text-[12px] text-[#aeaeb2] mt-8 text-center max-w-xs">
        Usá las mismas credenciales del campus oficial de la UTN
      </p>
    </div>
  );
}
