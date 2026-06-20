"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, ChevronRight, LogOut, Radio } from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";

const TOOLS: {
  href: string;
  title: string;
  description: string;
  Icon: React.ElementType;
  color: string;
  bg: string;
}[] = [
  {
    href: "/admin/testnotis",
    title: "Simulador PWA",
    description: "Disparar notificaciones push y ver el agente de asistencia",
    Icon: Bell,
    color: "#af52de",
    bg: "rgba(175,82,222,0.12)",
  },
];

export default function AdminDashboardClient() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    router.replace("/admin/login");
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />

      <main className="mx-auto max-w-xl px-4 pt-12 pb-12">
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Admin" }]} />

        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[rgba(175,82,222,0.12)] text-[#af52de]">
            <Radio className="h-[22px] w-[22px]" />
          </span>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
              Panel interno
            </p>
            <h1 className="text-[26px] font-bold tracking-tight text-[var(--fg)] leading-none">Administración</h1>
          </div>
        </div>

        <section className="mb-7">
          <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
            Herramientas
          </p>
          <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm divide-y divide-[var(--separator)]">
            {TOOLS.map((tool) => (
              <Link
                key={tool.href}
                href={tool.href}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-black/5 dark:active:bg-white/5"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
                  style={{ backgroundColor: tool.bg, color: tool.color }}
                >
                  <tool.Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-medium text-[var(--fg)]">{tool.title}</span>
                  <span className="block text-[12px] text-[var(--secondary)] truncate">{tool.description}</span>
                </span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[var(--secondary)]" />
              </Link>
            ))}
          </div>
        </section>

        <section>
          <div className="overflow-hidden rounded-[20px] border border-[rgba(255,59,48,0.2)] bg-[var(--surface)] shadow-sm">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-black/5 dark:active:bg-white/5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(255,59,48,0.1)]">
                <LogOut className="h-[18px] w-[18px] text-[#ff3b30]" />
              </span>
              <span className="flex-1 text-[15px] font-medium text-[#ff3b30]">Cerrar sesión de admin</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
