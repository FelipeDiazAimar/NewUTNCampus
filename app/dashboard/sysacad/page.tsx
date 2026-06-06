"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  ClipboardList,
  GitBranch,
  GraduationCap,
  KeyRound,
  ListChecks,
  LogOut,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import SysacadWidget, { type SysacadCredentials } from "@/components/SysacadWidget";
import ComingSoonModal from "@/components/ComingSoonModal";

type SysacadUser = { legajo: string; alumno: string; facultad: number };
type MenuLink = { label: string; href: string };

/** Vistas ya implementadas (Fase 2/3). */
const FEATURES = [
  { href: "/dashboard/sysacad/notas", title: "Notas de parciales", subtitle: "Materias en curso e inasistencias", icon: ListChecks, tone: "#007aff" },
  { href: "/dashboard/sysacad/estado", title: "Estado académico", subtitle: "Aprobadas, en curso y notas", icon: ClipboardList, tone: "#34c759" },
  { href: "/dashboard/sysacad/materias", title: "Materias del plan", subtitle: "Plan de estudios completo", icon: BookOpen, tone: "#ff9500" },
  { href: "/dashboard/sysacad/correlatividades", title: "Correlatividades", subtitle: "Qué podés cursar y qué falta", icon: GitBranch, tone: "#af52de" },
  { href: "/dashboard/sysacad/password", title: "Cambiar contraseña", subtitle: "Actualizá tu clave de Sysacad", icon: KeyRound, tone: "#8e8e93" },
] as const;

/** Labels del menú scrapeado que ya cubre una vista propia (no mostrar como "próximamente"). */
const COVERED = ["nota", "estado", "materia", "correlativ", "contrase", "password"];

function getSysacadUser(): SysacadUser | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/sysacad_user=([^;]+)/);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
}

export default function SysacadPage() {
  const router = useRouter();
  const [user, setUser] = useState<SysacadUser | null>(null);
  const [menu, setMenu] = useState<MenuLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [comingSoon, setComingSoon] = useState<string | null>(null);

  useEffect(() => {
    // Must be authenticated in the campus first (same gate as the rest of /dashboard).
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    setUser(getSysacadUser());
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
      setUser({ legajo: json.legajo, alumno: json.alumno, facultad: json.facultad });
      setMenu(json.menu ?? []);
    } catch {
      setError("Error de conexión con Sysacad.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/sysacad", { method: "DELETE" });
    setUser(null);
    setMenu([]);
    setError("");
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <Navbar />
      </div>
    );
  }

  // Opciones del menú scrapeado que aún no tienen pantalla propia → "próximamente".
  const otras = menu.filter(
    (m) => !COVERED.some((c) => m.label.toLowerCase().includes(c))
  );

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />

      <main className="max-w-xl mx-auto px-4 pt-20 pb-12">
        <Breadcrumb
          items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sysacad" }]}
        />

        {user ? (
          // ── Authenticated state ──────────────────────────────────────────
          <>
            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-16 h-16 rounded-[22px] bg-[var(--accent-light)] flex items-center justify-center mb-3 shadow-sm">
                <GraduationCap className="w-8 h-8 text-[#af52de]" />
              </div>
              <p className="text-xs font-semibold tracking-widest text-[var(--accent)] uppercase mb-1">
                Sysacad · Conectado
              </p>
              <h1 className="text-[24px] font-bold text-[var(--fg)] tracking-tight">
                {user.alumno ? `¡Hola, ${user.alumno.split(",").pop()?.trim() || user.alumno}!` : "¡Bienvenido!"}
              </h1>
              <p className="text-sm text-[var(--secondary)] mt-0.5">Legajo {user.legajo}</p>
            </div>

            {/* Vistas disponibles */}
            <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] overflow-hidden shadow-sm mb-6">
              {FEATURES.map((f, i) => {
                const Icon = f.icon;
                return (
                  <Link
                    key={f.href}
                    href={f.href}
                    className={`flex items-center gap-3.5 px-4 py-3.5 active:bg-[rgba(0,0,0,0.04)] dark:active:bg-[rgba(255,255,255,0.06)] ${
                      i < FEATURES.length - 1 ? "border-b border-[var(--separator)]" : ""
                    }`}
                  >
                    <div
                      className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${f.tone}1a`, color: f.tone }}
                    >
                      <Icon className="w-[18px] h-[18px]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-[var(--fg)]">{f.title}</p>
                      <p className="text-[12px] text-[var(--secondary)] truncate">{f.subtitle}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--secondary)] shrink-0" />
                  </Link>
                );
              })}
            </div>

            {/* Otras opciones del menú (todavía sin pantalla propia) */}
            {otras.length > 0 && (
              <>
                <p className="px-1 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Más opciones
                </p>
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] overflow-hidden shadow-sm mb-6">
                  {otras.map((item, i) => (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => setComingSoon(item.label)}
                      className={`w-full flex items-center justify-between px-4 py-3.5 text-left active:bg-[rgba(0,0,0,0.04)] dark:active:bg-[rgba(255,255,255,0.06)] ${
                        i < otras.length - 1 ? "border-b border-[var(--separator)]" : ""
                      }`}
                    >
                      <span className="text-[15px] font-medium text-[var(--fg)]">{item.label}</span>
                      <ChevronRight className="w-4 h-4 text-[var(--secondary)] shrink-0" />
                    </button>
                  ))}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={handleLogout}
              className="w-full py-3.5 rounded-2xl bg-[var(--surface)] border border-[var(--separator)] text-[#ff3b30] font-semibold text-[15px] active:opacity-80 transition-opacity shadow-sm flex items-center justify-center gap-2"
            >
              <LogOut className="w-[18px] h-[18px]" />
              Cerrar sesión de Sysacad
            </button>
          </>
        ) : (
          // ── Login state ──────────────────────────────────────────────────
          <div className="flex flex-col items-center pt-4">
            <SysacadWidget onSubmit={handleLogin} loading={loading} error={error} />
          </div>
        )}
      </main>

      <ComingSoonModal
        open={comingSoon !== null}
        title={comingSoon ?? undefined}
        onClose={() => setComingSoon(null)}
      />
    </div>
  );
}
