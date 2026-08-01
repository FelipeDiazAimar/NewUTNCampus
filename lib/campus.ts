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
  // Singular/plural: Sysacad dice "Sistemas de Apoyo…" y Moodle "Sistema de
  // Apoyo…". No busca ser lingüísticamente correcto, solo aplicarse igual a
  // ambos lados; por eso alcanza con sacar la "s" final de las palabras largas.
  return out
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => (p.length > 3 ? p.replace(/s$/, "") : p))
    .join(" ")
    .trim();
}

/** Palabras que no aportan a identificar una carrera. */
const VACIAS = new Set(["en", "de", "del", "la", "las", "el", "los", "y"]);

function tokens(s: string): string[] {
  return normalizarNombre(s)
    .split(" ")
    .filter((t) => t && !VACIAS.has(t));
}

/**
 * ¿Los tokens de la especialidad aparecen, en orden y como prefijo, en el
 * nombre de la categoría? Sysacad guarda la carrera abreviada
 * ("Ing. Sist. Inf.") y Moodle la escribe completa ("Ingeniería en Sistemas de
 * Información"), así que comparar por igualdad no alcanza.
 */
function tokensCoinciden(especialidad: string, categoria: string): boolean {
  const buscados = tokens(especialidad);
  if (buscados.length === 0) return false;
  let i = 0;
  for (const palabra of tokens(categoria)) {
    if (i < buscados.length && palabra.startsWith(buscados[i])) i++;
  }
  return i === buscados.length;
}

/**
 * Resuelve la categoría de Moodle que corresponde a la carrera del alumno.
 * Primero intenta igualdad exacta y después el matcheo por prefijos; en ambos
 * casos exige una única candidata, para no elegir una carrera al azar.
 */
export function matchearCarrera<T extends { nombre: string }>(
  especialidad: string,
  categorias: T[]
): T | null {
  const objetivo = normalizarNombre(especialidad);
  if (!objetivo) return null;

  const exactas = categorias.filter((c) => normalizarNombre(c.nombre) === objetivo);
  if (exactas.length === 1) return exactas[0];

  const porTokens = categorias.filter((c) => tokensCoinciden(especialidad, c.nombre));
  return porTokens.length === 1 ? porTokens[0] : null;
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
  anio: number,
  carrera?: string | null
): CampusCurso | null {
  const objetivo = normalizarNombre(nombreMateria);
  if (!objetivo) return null;
  const candidatos = cursos.filter((c) => {
    const anioCurso = extraerAnio(c.nombre);
    if (anioCurso !== null && anioCurso !== anio) return false;
    return normalizarNombre(c.nombre) === objetivo;
  });
  if (candidatos.length === 1) return candidatos[0];
  if (candidatos.length > 1 && carrera) return desempatarPorCarrera(candidatos, carrera);
  return null;
}

/**
 * Las materias básicas se dictan por carrera y solo se distinguen por el
 * sufijo que normalizarNombre justamente descarta ("Análisis Matemático I 2026
 * - Ing. en Sistemas" vs "… - Ing. Electromecánica - Electrónica - Química").
 * Se queda con el curso que más tokens de la carrera del alumno nombra, y solo
 * si hay un único ganador.
 */
function desempatarPorCarrera(candidatos: CampusCurso[], carrera: string): CampusCurso | null {
  const buscados = tokens(carrera);
  if (buscados.length === 0) return null;

  // Bidireccional a propósito: acá la carrera viene completa ("Ingeniería…") y
  // el curso la abrevia ("Ing. en Sistemas"), al revés que en matchearCarrera.
  // El largo mínimo evita que una palabra suelta como "I" matchee cualquier cosa.
  const esPrefijo = (a: string, b: string) =>
    Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a));

  const puntaje = (nombre: string) => {
    const palabras = sinAcentos(nombre).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let i = 0;
    for (const p of palabras) {
      if (i < buscados.length && esPrefijo(p, buscados[i])) i++;
    }
    return i;
  };

  const puntuados = candidatos.map((c) => ({ curso: c, pts: puntaje(c.nombre) }));
  const max = Math.max(...puntuados.map((p) => p.pts));
  if (max === 0) return null;
  const ganadores = puntuados.filter((p) => p.pts === max);
  return ganadores.length === 1 ? ganadores[0].curso : null;
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
