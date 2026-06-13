"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { LogIn, ShieldOff } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import SessionGuard from "./SessionGuard";
import { clearCourseCache } from "@/lib/hooks";
import { isGuestMode } from "@/lib/guest";

const ADMIN_TOKEN = "campus-admin-2024-internal";

export default function Navbar({ fullname }: { fullname?: string }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsAndroid(/Android/i.test(navigator.userAgent));
    setIsAdmin(document.cookie.includes(`admin_session_token=${ADMIN_TOKEN}`));
    setIsGuest(isGuestMode());
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  const loggedIn = mounted && typeof document !== "undefined" && document.cookie.includes("moodle_user");
  const { data: unread } = useSWR(
    loggedIn ? "/api/chat/unread" : null,
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { count: 0 })),
    { refreshInterval: 60_000, revalidateOnFocus: true, dedupingInterval: 30_000 }
  );
  const unreadCount: number = unread?.count ?? 0;

  async function logout() {
    await Promise.all([
      fetch("/api/auth", { method: "DELETE" }),
      fetch("/api/sysacadws/login", { method: "DELETE" }),
    ]);
    clearCourseCache();
    router.push("/");
  }

  async function exitAdmin() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    setIsAdmin(false);
    router.refresh();
  }

  return (
    <header className="sticky top-4 z-50 w-full will-change-transform">
      <div className="max-w-[1600px] mx-auto px-4 mb-6">
        <div className={`relative w-full h-12 flex items-center justify-between rounded-2xl ${isAndroid ? "backdrop-blur-md" : "backdrop-blur-xl"} backdrop-saturate-150 bg-[var(--navbar-bg)] border border-[var(--navbar-border)] shadow-sm px-4`}>

          {/* Logo */}
          <Link
            href={unreadCount > 0 ? "/chat" : "/dashboard"}
            aria-label={unreadCount > 0 ? `Chat · ${unreadCount} sin leer` : "Dashboard"}
            className="relative flex items-center gap-2 text-[15px] font-semibold text-[var(--fg)] hover:opacity-70 transition-opacity shrink-0"
          >
            {mounted && (
              <>
                <img src={isDark ? "/UTNW.png" : "/UTN.png"} alt="UTN"
                  className="hidden md:block w-[110px] h-6 object-contain" />
                <img src={isDark ? "/LOGOUTNW.png" : "/LOGOUTNB.png"} alt="UTN"
                  className="block md:hidden w-6 h-6 object-contain" />
              </>
            )}
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-2 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[var(--navbar-bg)]">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>

          {/* Modo invitado: en mobile flex-1 centrado entre elementos; en desktop absolutamente centrado */}
          {mounted && isGuest && (
            <span className="flex-1 min-w-0 text-center md:flex-none md:absolute md:left-1/2 md:-translate-x-1/2 md:pointer-events-none text-[12px] font-medium text-[#34c759] truncate px-2">
              <span className="hidden sm:inline">Modo invitado — estás explorando con datos de ejemplo</span>
              <span className="sm:hidden">Modo invitado</span>
            </span>
          )}

          {/* Spacer cuando no es invitado */}
          {(!mounted || !isGuest) && <span className="flex-1" />}

          {/* Right actions */}
          <div className="flex items-center gap-2 shrink-0">
            {fullname && !isGuest && (
              <span className="text-[13px] text-[var(--secondary)] hidden sm:block truncate max-w-[160px]">
                {fullname}
              </span>
            )}
            {mounted && isAdmin && (
              <button
                onClick={exitAdmin}
                title="Salir del modo admin"
                className="flex items-center gap-1 rounded-full bg-[rgba(175,82,222,0.12)] px-2.5 py-1 text-[12px] font-semibold text-[#af52de] transition-all duration-200 hover:bg-[rgba(175,82,222,0.22)] active:scale-95"
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Admin
              </button>
            )}
            <ThemeToggle />
            {mounted && isGuest ? (
              <button
                onClick={async () => {
                  // Limpiar cookies de invitado antes de ir al login
                  await Promise.all([
                    fetch("/api/auth", { method: "DELETE" }),
                    fetch("/api/sysacadws/login", { method: "DELETE" }),
                  ]).catch(() => {});
                  router.push("/");
                }}
                className="flex items-center gap-1.5 rounded-full bg-[#007aff] px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-80 active:opacity-70"
              >
                <LogIn className="h-3 w-3" />
                Iniciar sesión
              </button>
            ) : (
              <button
                onClick={logout}
                className="text-[14px] text-[#007aff] dark:text-[#0a84ff] font-medium hover:opacity-70 transition-opacity whitespace-nowrap"
              >
                Cerrar sesión
              </button>
            )}
          </div>
        </div>
      </div>
      <SessionGuard />
    </header>
  );
}
