"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import Spinner, { SpinnerOverlay } from "@/components/Spinner";

export default function LoginPage() {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (document.cookie.includes("moodle_user")) router.push("/dashboard");
  }, [router]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

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
    <>
      {/* Full-screen frosted overlay while authenticating */}
      <SpinnerOverlay visible={loading} label="Iniciando sesión…" />

      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] px-6">
        {/* Logo */}
        <div className="mb-10 flex flex-col items-center gap-3">
          <div className="w-20 h-20 md:w-[250px] md:h-[70px] rounded-full md:rounded-[22px] bg-[var(--accent-light)] flex items-center justify-center shadow-sm">
            {mounted && (
              <>
                <img
                  src={isDark ? "/UTNW.png" : "/UTN.png"}
                  alt="UTN"
                  className="hidden md:block w-[230px] h-[64px] object-contain"
                />
                <img
                  src={isDark ? "/LOGOUTNW.png" : "/LOGOUTNB.png"}
                  alt="UTN"
                  className="block md:hidden w-[56px] h-[56px] object-contain"
                />
              </>
            )}
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold tracking-widest text-[var(--accent)] uppercase mb-1">
              UTN · FRSF
            </p>
            <h1 className="text-[28px] font-bold text-[var(--fg)] tracking-tight">
              Campus Virtual
            </h1>
            <p className="text-sm text-[var(--secondary)] mt-0.5">
              Facultad Regional San Francisco
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="w-full max-w-[340px] flex flex-col gap-0">
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] overflow-hidden mb-4 shadow-sm">
            <div className="flex items-center px-4 py-0 border-b border-[var(--separator)]">
              <label className="text-sm font-medium text-[var(--fg)] w-24 shrink-0 py-3.5">
                Usuario
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="tu.nombre"
                required
                disabled={loading}
                autoCapitalize="none"
                autoCorrect="off"
                className="login-input flex-1 py-3.5 text-sm text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none bg-transparent disabled:opacity-50"
              />
            </div>
            <div className="flex items-center px-4 py-0">
              <label className="text-sm font-medium text-[var(--fg)] w-24 shrink-0 py-3.5">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
                className="login-input flex-1 py-3.5 text-sm text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none bg-transparent disabled:opacity-50"
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
        </form>

        <p className="text-[12px] text-[#aeaeb2] mt-8 text-center max-w-xs">
          Usá las mismas credenciales del campus oficial de la UTN
        </p>
      </div>
    </>
  );
}
