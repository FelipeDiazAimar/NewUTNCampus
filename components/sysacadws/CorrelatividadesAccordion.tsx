"use client";

import { GitBranch } from "lucide-react";
import { useCorrelatividades } from "@/lib/sysacadHooks";
import CollapsibleCard from "./CollapsibleCard";

/** Píldora disponible/bloqueada. */
function Pill({ ok }: { ok: boolean }) {
  const tone = ok ? "#34c759" : "#ff9500";
  return (
    <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: `${tone}1a`, color: tone }}>
      {ok ? "Disponible" : "Bloqueada"}
    </span>
  );
}

/** Correlatividades (scraping) embebidas como desplegable, agrupadas por nivel. */
export default function CorrelatividadesAccordion() {
  const { data, isLoading } = useCorrelatividades();
  const items = data?.data ?? [];

  // Agrupar por nivel preservando el orden.
  const grupos = new Map<string, typeof items>();
  for (const m of items) {
    const nivel = m.nivel || "—";
    if (!grupos.has(nivel)) grupos.set(nivel, []);
    grupos.get(nivel)!.push(m);
  }
  const ordenado = [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }));

  return (
    <CollapsibleCard
      title="Correlatividades"
      icon={GitBranch}
      iconColor="#af52de"
      right={items.length > 0 ? <span className="text-[12px] text-[var(--secondary)]">{items.length}</span> : undefined}
    >
      {isLoading && items.length === 0 ? (
        <p className="text-[14px] text-[var(--secondary)] text-center py-4">Cargando…</p>
      ) : ordenado.length === 0 ? (
        <p className="text-[14px] text-[var(--secondary)] text-center py-4">
          Disponible al iniciar sesión en Sysacad.
        </p>
      ) : (
        <div className="space-y-4">
          {ordenado.map(([nivel, list]) => (
            <div key={nivel}>
              <p className="px-1 mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                Nivel {nivel}
              </p>
              <div className="rounded-2xl border border-[var(--separator)] overflow-hidden divide-y divide-[var(--separator)]">
                {list.map((m, i) => (
                  <div key={`${nivel}-${i}`} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-medium text-[var(--fg)] leading-snug">{m.materia}</p>
                      {!m.puedeCursar && m.motivo && (
                        <p className="text-[12px] text-[var(--secondary)] mt-0.5 whitespace-pre-line">{m.motivo}</p>
                      )}
                    </div>
                    <Pill ok={m.puedeCursar} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </CollapsibleCard>
  );
}
