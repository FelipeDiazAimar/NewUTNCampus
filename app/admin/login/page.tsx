"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, User, Eye, EyeOff, ShieldCheck } from "lucide-react";

// useSearchParams requiere Suspense boundary en Next.js App Router.
export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  );
}

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Destino tras el login: usa ?next= si está definido, o el dashboard admin.
  const nextUrl = searchParams.get("next") ?? "/admin/dashboard";

  useEffect(() => {
    if (document.cookie.includes("admin_session_token=campus-admin")) {
      router.replace(nextUrl);
    }
  }, [router, nextUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Credenciales incorrectas.");
        return;
      }
      router.replace(nextUrl);
    } catch {
      setError("Error de red. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      {/* Card glassmorphism */}
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-[#007aff] shadow-[0_8px_24px_rgba(0,122,255,0.35)]">
            <ShieldCheck className="h-9 w-9 text-white" />
          </div>
          <h1 className="text-[24px] font-bold tracking-tight text-[var(--fg)]">Acceso restringido</h1>
          <p className="mt-1 text-[14px] text-[var(--secondary)]">Panel interno de administración</p>
        </div>

        {/* Form card */}
        <form
          onSubmit={handleSubmit}
          className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm"
        >
          {/* Username */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--separator)]">
            <User className="h-[18px] w-[18px] shrink-0 text-[var(--secondary)]" />
            <input
              type="text"
              placeholder="Usuario"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && passwordRef.current?.focus()}
              className="login-input flex-1 bg-transparent text-[16px] text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none"
            />
          </div>

          {/* Password */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <Lock className="h-[18px] w-[18px] shrink-0 text-[var(--secondary)]" />
            <input
              ref={passwordRef}
              type={showPass ? "text" : "password"}
              placeholder="Contraseña"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="login-input flex-1 bg-transparent text-[16px] text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="text-[var(--secondary)] active:opacity-60"
            >
              {showPass ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
            </button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <p className="mt-3 px-4 text-[13px] text-[#ff3b30] text-center">{error}</p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !username || !password}
          onClick={handleSubmit}
          className="mt-4 w-full rounded-[14px] bg-[#007aff] py-3.5 text-[17px] font-semibold text-white shadow-[0_4px_14px_rgba(0,122,255,0.3)] transition-opacity active:opacity-80 disabled:opacity-40"
        >
          {loading ? "Verificando…" : "Ingresar"}
        </button>

        <p className="mt-4 text-center text-[12px] text-[var(--secondary)]">
          Solo para uso interno del equipo de desarrollo.
        </p>
      </div>
    </div>
  );
}
