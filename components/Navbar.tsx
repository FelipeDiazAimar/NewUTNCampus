"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

export default function Navbar({ fullname }: { fullname?: string }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/");
  }

  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{
        background: "var(--navbar-bg)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        borderBottom: "1px solid var(--navbar-border)",
      }}
    >
      <div className="max-w-2xl mx-auto px-4 h-12 flex items-center justify-between">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-[15px] font-semibold text-[var(--fg)] hover:opacity-70 transition-opacity"
        >
          <svg
            className="w-5 h-5 text-[#007aff] dark:text-[#0a84ff]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          Campus UTN
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
            className="text-[14px] text-[#007aff] dark:text-[#0a84ff] font-medium hover:opacity-70 transition-opacity"
          >
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}
