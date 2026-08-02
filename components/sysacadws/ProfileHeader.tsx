"use client";

import { RefreshCw } from "lucide-react";
import type { SysacadWsUser } from "@/lib/sysacadws";

function initials(nombre: string): string {
  const parts = nombre.replace(",", " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Cabecera tipo "Apple ID": avatar + nombre + legajo/especialidad + estado. */
export default function ProfileHeader({
  user,
  refreshing,
  onRefresh,
}: {
  user: SysacadWsUser;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const activo = /activo/i.test(user.estado);

  return (
    <div className="relative rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] backdrop-blur-md shadow-sm p-5">
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Recargar datos de Sysacad"
        className="absolute top-4 right-4 inline-flex items-center gap-1.5 rounded-full border border-[#5ac8fa4d] px-3 py-1.5 text-[12px] font-semibold text-[#0a91c9] transition-colors hover:bg-[#5ac8fa1a] active:bg-[#5ac8fa26] disabled:opacity-60 dark:text-[#5ac8fa]"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        Recargar
      </button>

      <div className="flex items-center gap-4 pr-24">
        <div className="w-16 h-16 rounded-full bg-[var(--accent-light)] flex items-center justify-center shrink-0 text-[22px] font-bold text-[var(--accent)]">
          {initials(user.nombre)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-bold text-[var(--fg)] tracking-tight truncate">{user.nombre}</h1>
          <p className="text-[13px] text-[var(--secondary)] truncate">
            Legajo {user.legajo} · {user.especialidad}
          </p>
          <span
            className="inline-flex items-center gap-1.5 mt-2 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{
              backgroundColor: activo ? "#34c7591a" : "#8e8e931a",
              color: activo ? "#34c759" : "#8e8e93",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: activo ? "#34c759" : "#8e8e93" }} />
            {user.estado}
          </span>
        </div>
      </div>
    </div>
  );
}
