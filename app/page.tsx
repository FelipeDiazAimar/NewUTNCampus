"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ChevronDown, X, Eye, EyeOff } from "lucide-react";
import Spinner, { SpinnerOverlay } from "@/components/Spinner";
import { getRememberedUsers, addRememberedUser, removeRememberedUser } from "@/lib/rememberedUsers";

export default function LoginPage() {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.cookie.includes("moodle_user")) router.push("/dashboard");
  }, [router]);

  useEffect(() => {
    setMounted(true);
    // Cuentas recordadas en este dispositivo → ofrecerlas al volver al login.
    const saved = getRememberedUsers();
    setAccounts(saved);
    if (saved.length > 0) {
      setUsername(saved[0]);
      setRemember(true);
      if (saved.length > 1) setAccountsOpen(true); // varias cuentas → ofrecer el selector
    }
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  function pickAccount(acc: string) {
    setUsername(acc);
    setRemember(true);
    setAccountsOpen(false);
    passwordRef.current?.focus();
  }

  function forgetAccount(acc: string) {
    removeRememberedUser(acc);
    const next = getRememberedUsers();
    setAccounts(next);
    if (next.length === 0) setAccountsOpen(false);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, remember }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Error desconocido");
      return;
    }
    // Guardar la cuenta en el dispositivo solo si pidió mantener sesión.
    if (remember) addRememberedUser(username);
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
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] mb-4 shadow-sm">
            <div className="relative border-b border-[var(--separator)]">
              <div className="flex items-center px-4 py-0">
                <label className="text-sm font-medium text-[var(--fg)] w-24 shrink-0 py-3.5">
                  Usuario
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => accounts.length > 0 && setAccountsOpen(true)}
                  placeholder="Nombre de usuario"
                  required
                  disabled={loading}
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="login-input flex-1 py-3.5 text-sm text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none bg-transparent disabled:opacity-50"
                />
                {accounts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAccountsOpen((o) => !o)}
                    className="shrink-0 p-1.5 -mr-1.5 text-[var(--secondary)] active:opacity-70"
                    aria-label="Elegir cuenta"
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform ${accountsOpen ? "rotate-180" : ""}`} />
                  </button>
                )}
              </div>

              {accountsOpen && accounts.length > 0 && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-20 cursor-default"
                    aria-label="Cerrar"
                    onClick={() => setAccountsOpen(false)}
                  />
                  <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-[var(--surface)] rounded-xl border border-[var(--separator)] shadow-lg overflow-hidden">
                    <p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                      Cuentas en este dispositivo
                    </p>
                    {accounts.map((acc) => (
                      <div key={acc} className="flex items-center border-t border-[var(--separator)] first:border-t-0">
                        <button
                          type="button"
                          onClick={() => pickAccount(acc)}
                          className="flex-1 text-left px-4 py-2.5 text-sm text-[var(--fg)] truncate active:bg-[var(--surface2)]"
                        >
                          {acc}
                        </button>
                        <button
                          type="button"
                          onClick={() => forgetAccount(acc)}
                          className="shrink-0 px-3 py-2.5 text-[var(--secondary)] active:opacity-70"
                          aria-label={`Quitar ${acc}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center px-4 py-0">
              <label className="text-sm font-medium text-[var(--fg)] w-24 shrink-0 py-3.5">
                Contraseña
              </label>
              <input
                ref={passwordRef}
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
                className="login-input flex-1 py-3.5 text-sm text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none bg-transparent disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                disabled={loading}
                className="shrink-0 p-1 text-[var(--secondary)] active:opacity-60 disabled:opacity-40"
              >
                {showPass ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
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

        {/* Botón modo invitado */}
        <a
          href="/api/guest/login"
          className="mt-3 w-full max-w-[340px] py-3.5 rounded-2xl border-2 border-[#34c759] text-[#34c759] font-semibold text-[15px] text-center active:opacity-70 transition-opacity flex items-center justify-center gap-2"
        >
          Explorar como invitado
        </a>

        <p className="text-[12px] text-[#aeaeb2] mt-6 text-center max-w-xs">
          Usá las mismas credenciales del campus oficial de la UTN
        </p>
      </div>
    </>
  );
}
