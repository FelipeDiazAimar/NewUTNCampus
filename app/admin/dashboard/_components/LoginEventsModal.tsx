"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";

interface UserSummary {
  userKey: string;
  fullname: string | null;
  loginCount: number;
  lastLoginAt: string;
}

/** Modal con buscador: personas distintas que iniciaron sesión en el rango dado. */
export default function LoginEventsModal({
  open,
  onClose,
  from,
  to,
}: {
  open: boolean;
  onClose: () => void;
  from: string;
  to: string;
}) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ from, to });
      if (q.trim()) params.set("q", q.trim());
      fetch(`/api/admin/login-events?${params}`)
        .then((r) => r.json())
        .then((json) => setUsers(json.users ?? []))
        .catch(() => setUsers([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [open, from, to, q]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-6"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
      role="dialog"
      aria-modal="true"
    >
      <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={onClose} />

      <div className="relative w-full sm:max-w-md max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-[var(--separator)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[17px] font-bold text-[var(--fg)]">Personas que ingresaron</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[var(--surface2)] flex items-center justify-center active:opacity-70"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4 text-[var(--secondary)]" />
          </button>
        </div>

        <div className="px-5 pb-3">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--separator)] bg-[var(--surface2)] px-3 py-2.5">
            <Search className="w-4 h-4 text-[var(--secondary)]" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por mail o nombre"
              className="flex-1 bg-transparent outline-none text-[15px] text-[var(--fg)] placeholder:text-[var(--secondary)]"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 divide-y divide-[var(--separator)]">
          {loading ? (
            <p className="text-[13px] text-[var(--secondary)] text-center py-8">Buscando…</p>
          ) : users.length === 0 ? (
            <p className="text-[13px] text-[var(--secondary)] text-center py-8">Sin resultados.</p>
          ) : (
            users.map((u) => (
              <div key={u.userKey} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-[var(--fg)] truncate">{u.userKey}</p>
                  {u.fullname && <p className="text-[12px] text-[var(--secondary)] truncate">{u.fullname}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[13px] font-semibold text-[var(--fg)] tabular-nums">{u.loginCount}×</p>
                  <p className="text-[11px] text-[var(--secondary)]">{new Date(u.lastLoginAt).toLocaleDateString("es-AR")}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
