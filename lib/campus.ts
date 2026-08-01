/**
 * Campus virtual (Moodle) — tipos y helpers puros compartidos entre el scraping
 * del servidor y la UI. Todo lo de acá es sincrónico y sin dependencias, para
 * que sirva igual en el route handler y en el cliente.
 */

/** Un curso del catálogo de Moodle. */
export interface CampusCurso {
  /** data-courseid del coursebox — mismo id que MoodleCourse.id, en string. */
  id: string;
  nombre: string;
  /** El curso acepta auto-matriculación con clave (ícono fa-key). */
  autoMatriculacion: boolean;
}

/** Un grupo del catálogo: una categoría de Moodle con sus cursos. */
export interface CampusGrupo {
  categoriaId: string;
  titulo: string;
  cursos: CampusCurso[];
}

/** Respuesta de GET /api/campus/catalogo. */
export interface CampusCatalogo {
  /** Nombre de la categoría de carrera que se pudo resolver, o null. */
  carrera: string | null;
  grupos: CampusGrupo[];
}

/** Respuesta de POST /api/campus/matricular. */
export type MatricularResult =
  | { ok: true; yaMatriculado?: boolean }
  | { ok: false; motivo: string };

// ─── HTML ─────────────────────────────────────────────────────────────────────

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

// ─── Nombres ──────────────────────────────────────────────────────────────────

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Extrae un año de 4 dígitos (20xx) del texto, si lo hay. */
export function extraerAnio(s: string): number | null {
  const m = (s ?? "").match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Normaliza un nombre de materia/curso para comparar Sysacad contra Moodle.
 *
 * Sysacad dice "Programación Web (Elec.)" y Moodle "Programación Web 2026";
 * para las básicas Moodle agrega la carrera: "Análisis Matemático I 2026 -
 * Ing. en Sistemas". El orden de los pasos importa: el sufijo de carrera se
 * saca ANTES que la puntuación, porque se detecta por el " - Ing." literal.
 */
export function normalizarNombre(s: string): string {
  let out = sinAcentos(s ?? "").toLowerCase();
  out = out.replace(/\(\s*elec\.?\s*\)/g, " ");   // "(Elec.)"
  out = out.replace(/\b20\d{2}\b/g, " ");         // año del ciclo
  out = out.replace(/\s-\s*ing\b[\s\S]*$/, " ");  // "- Ing. en Sistemas", "- Ing. Química …"
  out = out.replace(/[^a-z0-9\s]/g, " ");         // puntuación
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Busca el curso del campus que corresponde a una materia de Sysacad.
 *
 * Devuelve el curso SOLO si hay exactamente una coincidencia. Con 0 o 2+ la
 * materia queda pendiente para que el alumno la matricule a mano: adivinar
 * sería escribir en la cuenta de Moodle de alguien sobre una corazonada.
 *
 * Pasale `NombreMateriaLargo`, no `NombreMateria`: el web service trunca el
 * corto a 40 caracteres ("Sistemas de Apoyo a la Gestión y a las D").
 */
export function matchearCurso(
  nombreMateria: string,
  cursos: CampusCurso[],
  anio: number
): CampusCurso | null {
  const objetivo = normalizarNombre(nombreMateria);
  if (!objetivo) return null;
  const candidatos = cursos.filter((c) => {
    const anioCurso = extraerAnio(c.nombre);
    if (anioCurso !== null && anioCurso !== anio) return false;
    return normalizarNombre(c.nombre) === objetivo;
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * El CheckSum de Sysacad trae dos datos en líneas separadas:
 * "0V58ZF\nClave matriculación campus virtual = 5202340512026" — el código de
 * seguridad de la inscripción y la clave para auto-matricularse en Moodle.
 */
export function parseCheckSum(checkSum: string): { claveMatriculacion: string | null } {
  const claveLinea = (checkSum ?? "").split("\n").find((l) => /clave matriculaci/i.test(l));
  const clave = claveLinea?.split("=")[1]?.trim() ?? null;
  return { claveMatriculacion: clave || null };
}
