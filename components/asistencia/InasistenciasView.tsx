"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CalendarX, ChevronDown } from "lucide-react";
import { SpinnerBlock } from "@/components/Spinner";

/** Lee el legajo del alumno desde la cookie del web service. */
function getLegajo(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/sysacadws_user=([^;]+)/);
  if (!m) return null;
  try {
    return (JSON.parse(decodeURIComponent(m[1])) as { legajo?: string }).legajo ?? null;
  } catch {
    return null;
  }
}

interface InasItem { CodMateria?: string; NombreMateria?: string; Materia?: string; Fecha?: string }
interface InasResp {
  Inasistencias?: InasItem[];
  data?: InasItem[];
  Materias?: { NombreMateria?: string; Materia?: string; Inasistencias?: { Fecha?: string }[] }[];
}

/** Normaliza distintas formas de respuesta a [{ materia, fechas[] }]. */
function normalize(resp: InasResp | null): { materia: string; fechas: string[] }[] {
  if (!resp) return [];
  if (Array.isArray(resp.Materias)) {
    return resp.Materias.map((m) => ({
      materia: m.NombreMateria || m.Materia || "Materia",
      fechas: (m.Inasistencias ?? []).map((x) => x.Fecha ?? "").filter(Boolean),
    })).filter((g) => g.fechas.length > 0);
  }
  const flat = resp.Inasistencias ?? resp.data ?? [];
  const map = new Map<string, string[]>();
  for (const it of flat) {
    const mat = it.NombreMateria || it.Materia || it.CodMateria || "Materia";
    if (!map.has(mat)) map.set(mat, []);
    if (it.Fecha) map.get(mat)!.push(it.Fecha);
  }
  return [...map.entries()].map(([materia, fechas]) => ({ materia, fechas }));
}

function fmtFecha(iso: string): string {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const fetcher = async (url: string): Promise<InasResp | null> => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
};

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

export default function InasistenciasView() {
  const legajo = getLegajo();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading } = useSWR(
    legajo ? `/api/sysacadws/cursado/inasistencias/${legajo}/${year}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5 * 60_000 }
  );

  if (!legajo) {
    return (
      <div className="rounded-2xl border border-[var(--separator)] bg-[var(--surface)] p-6 text-center shadow-sm">
        <p className="text-[14px] text-[var(--secondary)]">Iniciá sesión en Sysacad para ver tus inasistencias.</p>
        <Link href="/sysacad" className="inline-block mt-3 rounded-2xl bg-[#007aff] px-4 py-2 text-[14px] font-semibold text-white active:opacity-80">
          Ir a Sysacad
        </Link>
      </div>
    );
  }

  const grupos = normalize(data ?? null);

  return (
    <div>
      {/* Selector de año */}
      <div className="flex gap-1 mb-3 overflow-x-auto">
        {YEARS.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYear(y)}
            className={`px-3.5 py-1.5 rounded-full text-[14px] font-semibold whitespace-nowrap transition-colors ${
              y === year ? "bg-[var(--accent)] text-white" : "text-[var(--secondary)] active:bg-[var(--surface2)]"
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      {isLoading && <SpinnerBlock label="Consultando inasistencias…" />}

      {!isLoading && grupos.length === 0 && (
        <div className="rounded-2xl border border-[var(--separator)] bg-[var(--surface)] p-6 text-center shadow-sm">
          <CalendarX className="w-8 h-8 text-[#34c759] mx-auto mb-2" />
          <p className="text-[14px] text-[var(--secondary)]">Sin inasistencias registradas en {year}.</p>
        </div>
      )}

      {!isLoading && grupos.length > 0 && (
        <div className="space-y-3">
          {grupos.map((g) => {
            const isOpen = open === g.materia;
            const total = g.fechas.length;
            const tone = total >= 3 ? "#ff3b30" : total >= 1 ? "#ff9500" : "#34c759";
            return (
              <div key={g.materia} className="rounded-2xl border border-[var(--separator)] bg-[var(--surface)] shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : g.materia)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-[var(--surface2)]"
                >
                  <span className="flex-1 text-[15px] font-semibold text-[var(--fg)] leading-snug">{g.materia}</span>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ backgroundColor: `${tone}1a`, color: tone }}>
                    {total} {total === 1 ? "falta" : "faltas"}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-[var(--secondary)] shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="border-t border-[var(--separator)] divide-y divide-[var(--separator)]">
                    {g.fechas.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                        <CalendarX className="w-4 h-4 text-[#ff9500] shrink-0" />
                        <span className="text-[14px] text-[var(--fg)] tabular-nums">{fmtFecha(f)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
