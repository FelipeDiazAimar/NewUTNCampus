import type { SysacadWsUser } from "@/lib/sysacadws";

function initials(nombre: string): string {
  const parts = nombre.replace(",", " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Cabecera tipo "Apple ID": avatar + nombre + legajo/especialidad + estado. */
export default function ProfileHeader({ user }: { user: SysacadWsUser }) {
  const activo = /activo/i.test(user.estado);
  return (
    <div className="rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] backdrop-blur-md shadow-sm p-5 flex items-center gap-4">
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
  );
}
