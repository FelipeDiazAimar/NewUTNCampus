import { GraduationCap } from "lucide-react";
import { parseNota, type SysacadExamen, type SysacadPlanMateria } from "@/lib/sysacadws";
import type { MateriaEstado } from "@/lib/sysacadTypes";
import CollapsibleCard from "./CollapsibleCard";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function formatFecha(iso: string): string {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : iso;
}

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(DIACRITICS, "").trim();
}

/** "Anual" | "1c" → "1er cuatrimestre" | "2c" → "2do cuatrimestre". */
function cuatriLabel(c?: string): string {
  if (!c) return "";
  const x = c.trim().toLowerCase();
  if (x === "anual") return "Anual";
  if (x.startsWith("1")) return "1er cuatrimestre";
  if (x.startsWith("2")) return "2do cuatrimestre";
  return "";
}

type Row = {
  materia: string;
  cuatri: string;
  estadoTxt: string;
  fecha?: string;
  notaLabel: string;
  notaTone: string;
  esNumero: boolean;
};

/**
 * Sección unificada: combina Estado académico (scraping) + Historial de notas
 * (web service) + cuatrimestre del Plan, agrupada por año.
 */
export default function HistorialAcademico({
  estado,
  examenes,
  planMaterias,
}: {
  estado: MateriaEstado[];
  examenes: SysacadExamen[];
  planMaterias: SysacadPlanMateria[];
}) {
  const cuatriByName = new Map(planMaterias.map((m) => [norm(m.NombreMateria), m.Cuatrimestre]));

  // Último examen rendido por materia (para la fecha + nota).
  const examByName = new Map<string, SysacadExamen>();
  for (const ex of examenes) {
    const k = norm(ex.NombreMateria);
    const prev = examByName.get(k);
    if (!prev || ex.FechaExamen > prev.FechaExamen) examByName.set(k, ex);
  }

  // Construye una fila a partir del estado (o del plan si no hay scraping).
  function buildRow(materia: string, cuatriRaw: string | undefined, estadoRaw: string, nota: string | undefined): Row {
    const ex = examByName.get(norm(materia));
    let notaLabel = "—";
    let notaTone = "var(--secondary)";
    let esNumero = false;
    let estadoTxt = "";

    if (nota) {
      notaLabel = nota;
      notaTone = Number(nota) >= 6 ? "#34c759" : "#ff3b30";
      esNumero = true;
      estadoTxt = "Aprobada";
    } else if (/cursa/i.test(estadoRaw)) {
      notaLabel = "Cursando";
      notaTone = "#007aff";
      estadoTxt = "Cursando";
    } else if (/aprob/i.test(estadoRaw)) {
      notaLabel = "Aprobada";
      notaTone = "#34c759";
      estadoTxt = "Aprobada";
    } else if (ex) {
      const n = parseNota(ex.Nota);
      notaLabel = n.label;
      notaTone = n.ausente ? "#8e8e93" : n.aprobada ? "#34c759" : "#ff3b30";
      esNumero = /^\d+$/.test(n.label);
      estadoTxt = "Rendida";
    } else {
      estadoTxt = "Pendiente";
    }
    return { materia, cuatri: cuatriLabel(cuatriRaw), estadoTxt, fecha: ex?.FechaExamen, notaLabel, notaTone, esNumero };
  }

  // Spine: el estado académico (todas las materias con su situación). Si no está
  // disponible (sin sesión de scraping), usamos el plan de estudio. Cada fila
  // lleva su año para poder agrupar por año → cuatrimestre.
  const rows: (Row & { anio: string })[] = [];
  if (estado.length > 0) {
    for (const m of estado) {
      rows.push({ ...buildRow(m.materia, cuatriByName.get(norm(m.materia)), m.estado, m.nota), anio: m.nivel || "—" });
    }
  } else {
    for (const m of planMaterias) {
      rows.push({ ...buildRow(m.NombreMateria, m.Cuatrimestre, "", undefined), anio: m.Año || "—" });
    }
  }

  const anios = [...new Set(rows.map((r) => r.anio))].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));

  return (
    <CollapsibleCard
      title="Historial académico"
      icon={GraduationCap}
      iconColor="#af52de"
      right={<span className="text-[12px] text-[var(--secondary)]">{rows.length} materias</span>}
    >
      {rows.length === 0 ? (
        <p className="text-[14px] text-[var(--secondary)] text-center py-4">Sin información para mostrar.</p>
      ) : (
        <div className="space-y-4">
          {anios.map((anio) => {
            const delAnio = rows.filter((r) => r.anio === anio);
            const cuatris = [...new Set(delAnio.map((r) => r.cuatri))].sort((a, b) => cuatriRank(a) - cuatriRank(b));
            return (
              <div key={anio}>
                <p className="px-1 mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Año {anio}
                </p>
                <div className="space-y-3">
                  {cuatris.map((cuatri) => {
                    const list = delAnio.filter((r) => r.cuatri === cuatri);
                    return (
                      <div key={cuatri || "_"}>
                        {cuatri && (
                          <p className="px-1 mb-1 text-[11px] font-medium text-[var(--secondary)]">{cuatri}</p>
                        )}
                        <div className="rounded-2xl border border-[var(--separator)] overflow-hidden divide-y divide-[var(--separator)]">
                          {list.map((r, i) => (
                            <RowItem key={`${r.materia}-${i}`} r={r} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleCard>
  );
}

const CUATRI_ORDER = ["Anual", "1er cuatrimestre", "2do cuatrimestre"];
function cuatriRank(c: string): number {
  const i = CUATRI_ORDER.indexOf(c);
  return i === -1 ? CUATRI_ORDER.length : i; // sin cuatrimestre al final
}

function RowItem({ r }: { r: Row }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-[var(--fg)] leading-snug">{r.materia}</p>
        <p className="text-[12px] text-[var(--secondary)] mt-0.5">
          {[r.estadoTxt, r.fecha ? `rendida ${formatFecha(r.fecha)}` : ""].filter(Boolean).join(" · ")}
        </p>
      </div>
      {r.esNumero ? (
        <span className="shrink-0 text-[18px] font-bold tabular-nums" style={{ color: r.notaTone }}>
          {r.notaLabel}
        </span>
      ) : (
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap"
          style={{ backgroundColor: `${r.notaTone}1a`, color: r.notaTone }}
        >
          {r.notaLabel}
        </span>
      )}
    </div>
  );
}
