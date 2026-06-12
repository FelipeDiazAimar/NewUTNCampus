"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import useSWR from "swr";
import ThemeToggle from "./ThemeToggle";
import SessionGuard from "./SessionGuard";
import { clearCourseCache } from "@/lib/hooks";

export default function Navbar({ fullname }: { fullname?: string }) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  // Mensajes sin leer → badge rojo en el logo. Solo si hay sesión de Campus.
  const loggedIn = mounted && typeof document !== "undefined" && document.cookie.includes("moodle_user");
  const { data: unread } = useSWR(
    loggedIn ? "/api/chat/unread" : null,
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { count: 0 })),
    { refreshInterval: 60_000, revalidateOnFocus: true, dedupingInterval: 30_000 }
  );
  const unreadCount: number = unread?.count ?? 0;

  async function logout() {
    // Cierre de sesión centralizado: campus (Moodle) + Sysacad (web service).
    // El DELETE del WS limpia también las cookies del viejo scraping.
    await Promise.all([
      fetch("/api/auth", { method: "DELETE" }),
      fetch("/api/sysacadws/login", { method: "DELETE" }),
    ]);
    clearCourseCache();
    router.push("/");
  }

  return (
    <header className="sticky top-4 z-50 w-full">
      <div className="max-w-[1600px] mx-auto px-4 mb-6">
        <div className="w-full h-12 flex items-center justify-between rounded-2xl backdrop-blur-xl backdrop-saturate-150 bg-[var(--navbar-bg)] border border-[var(--navbar-border)] shadow-sm px-4">
        <Link
          href={unreadCount > 0 ? "/chat" : "/dashboard"}
          aria-label={unreadCount > 0 ? `Chat · ${unreadCount} sin leer` : "Dashboard"}
          className="relative flex items-center gap-2 text-[15px] font-semibold text-[var(--fg)] hover:opacity-70 transition-opacity"
        >
          {mounted && (
            <>
              <img
                src={isDark ? "/UTNW.png" : "/UTN.png"}
                alt="UTN"
                className="hidden md:block w-[110px] h-6 object-contain"
              />
              <img
                src={isDark ? "/LOGOUTNW.png" : "/LOGOUTNB.png"}
                alt="UTN"
                className="block md:hidden w-6 h-6 object-contain"
              />
            </>
          )}
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-2 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[var(--navbar-bg)]">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>

        <div className="flex items-center gap-2">
          {fullname && (
            <span className="text-[13px] text-[var(--secondary)] hidden sm:block truncate max-w-[160px]">
              {fullname}
            </span>
          )}
          <ThemeToggle />
          <button
            onClick={logout}
            className="text-[14px] text-[#007aff] dark:text-[#0a84ff] font-medium hover:opacity-70 transition-opacity whitespace-nowrap"
          >
            Cerrar sesión
          </button>
        </div>
        </div>
      </div>
      <SessionGuard />
    </header>
  );
}
