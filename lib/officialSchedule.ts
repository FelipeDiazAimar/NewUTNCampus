/**
 * Grilla de horarios oficial publicada por UTN FRSF en sanfrancisco.utn.edu.ar
 * (una página estática por carrera, con una tabla Año/Día/Desde/Hasta/Materia/
 * Docente/Aula). Se usa para completar el aula cuando Sysacad no la trae, y
 * para marcar discrepancias cuando sí la trae pero no coincide.
 *
 * No hay una API: son páginas HTML armadas a mano (probablemente pegadas desde
 * Excel), así que se scrapean con regex igual que el resto del proyecto
 * (ver app/api/campus/catalogo/route.ts).
 */

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(DIACRITICS, "").trim();
}

const DAY_MAP: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

export interface OfficialSlot {
  anio: number;
  day: number; // 0=domingo … 6=sábado
  startMin: number;
  endMin: number;
  materiaNorm: string; // nombre normalizado, sin sufijos entre paréntesis
  materia: string;
  docente: string;
  aula: string; // texto tal cual viene en la grilla ("115", "Aula C", "Comedor")
}

/** Nombre de especialidad (Sysacad) → slug de la página de horarios. */
const CARRERA_URLS: Record<string, string> = {
  "ingenieria electronica": "https://sanfrancisco.utn.edu.ar/info/horarios-ingenieria-electronica-3",
  "ingenieria electromecanica": "https://sanfrancisco.utn.edu.ar/info/horarios-ingenieria-electromecanica-4",
  "ingenieria quimica": "https://sanfrancisco.utn.edu.ar/info/horarios-ingenieria-quimica-5",
  "ingenieria en sistemas de informacion": "https://sanfrancisco.utn.edu.ar/info/horarios-ingenieria-en-sistemas-de-informacion-2",
  "ingenieria industrial": "https://sanfrancisco.utn.edu.ar/info/horarios-ingenieria-industrial-6",
  "licenciatura en administracion rural": "https://sanfrancisco.utn.edu.ar/info/horarios-licenciatura-en-administracion-rural-7",
  "tecnicatura universitaria en programacion": "https://sanfrancisco.utn.edu.ar/info/horarios-tecnicatura-universitaria-en-programacion-8",
  "tecnicatura superior en programacion": "https://sanfrancisco.utn.edu.ar/info/horarios-tecnicatura-universitaria-en-programacion-8",
};

/** Palabras que no aportan a identificar una carrera. */
const VACIAS = new Set(["en", "de", "del", "la", "las", "el", "los", "y"]);

function tokens(s: string): string[] {
  return norm(s)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t && !VACIAS.has(t));
}

/**
 * ¿Los tokens de la especialidad aparecen, en orden y como prefijo, en el
 * nombre completo de la carrera? Sysacad guarda la carrera abreviada
 * ("Ing. Sist. Inf."), así que comparar por igualdad o `includes` no alcanza
 * (mismo problema que resuelve `matchearCarrera` en lib/campus.ts).
 */
function tokensCoinciden(especialidad: string, nombreCompleto: string): boolean {
  const buscados = tokens(especialidad);
  if (buscados.length === 0) return false;
  let i = 0;
  for (const palabra of tokens(nombreCompleto)) {
    if (i < buscados.length && palabra.startsWith(buscados[i])) i++;
  }
  return i === buscados.length;
}

/** Resuelve la URL de la grilla oficial a partir del nombre de especialidad de Sysacad. */
export function resolveCarreraUrl(especialidad: string): string | null {
  const n = norm(especialidad);
  if (CARRERA_URLS[n]) return CARRERA_URLS[n];

  const porTokens = Object.entries(CARRERA_URLS).filter(([key]) => tokensCoinciden(especialidad, key));
  if (process.env.NODE_ENV !== "production") {
    // TEMPORAL: para diagnosticar por qué no se resuelve la carrera con datos reales.
    console.log("[horarios-oficiales] especialidad:", JSON.stringify(especialidad), "→ candidatos:", porTokens.map(([k]) => k));
  }
  return porTokens.length === 1 ? porTokens[0][1] : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü",
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&(#(\d+)|[a-zA-Z]+);/g, (m, _all, dec) => {
      if (dec) return String.fromCharCode(Number(dec));
      const name = m.slice(1, -1);
      return NAMED_ENTITIES[name] ?? m;
    });
}

/** Texto plano de una celda: saca tags, decodifica entidades, colapsa espacios. */
function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** "Física II (comisión cuatrimestral)" → "fisica ii" para poder matchear contra Sysacad. */
export function normalizeMateriaName(s: string): string {
  return norm(s.replace(/\([^)]*\)/g, "")).replace(/\s+/g, " ").trim();
}

/** Parsea la tabla Año/Día/Desde/Hasta/Materia/Docente/Aula de la página oficial. */
export function parseOfficialScheduleHtml(html: string): OfficialSlot[] {
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/);
  if (!tableMatch) return [];

  const rows = [...tableMatch[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const out: OfficialSlot[] = [];
  let anioActual = 1;

  for (let i = 1; i < rows.length; i++) {
    // saltea la fila de encabezado (i=0)
    const cells = [...rows[i].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]));
    if (cells.length < 6) continue;

    let dia: string, desde: string, hasta: string, materia: string, docente: string, aula: string;
    if (cells.length >= 7) {
      const anioTxt = cells[0].match(/\d+/)?.[0];
      if (anioTxt) anioActual = Number(anioTxt);
      [, dia, desde, hasta, materia, docente, aula] = cells;
    } else {
      [dia, desde, hasta, materia, docente, aula] = cells;
    }

    const day = DAY_MAP[norm(dia)];
    const tDesde = desde.match(/(\d{1,2}):(\d{2})/);
    const tHasta = hasta.match(/(\d{1,2}):(\d{2})/);
    if (day === undefined || !tDesde || !tHasta || !materia) continue;

    out.push({
      anio: anioActual,
      day,
      startMin: Number(tDesde[1]) * 60 + Number(tDesde[2]),
      endMin: Number(tHasta[1]) * 60 + Number(tHasta[2]),
      materiaNorm: normalizeMateriaName(materia),
      materia,
      docente,
      aula,
    });
  }

  return out;
}

const cache = new Map<string, { at: number; slots: OfficialSlot[] }>();
const CACHE_MS = 24 * 60 * 60 * 1000; // 1 día: son páginas estáticas que casi no cambian en el cuatrimestre

/** Trae (con caché de 1 día en memoria + revalidate de Next) la grilla oficial de una carrera. */
export async function fetchOfficialSchedule(especialidad: string): Promise<OfficialSlot[]> {
  const url = resolveCarreraUrl(especialidad);
  if (!url) {
    console.log("[horarios-oficiales] no se pudo resolver la URL para especialidad:", JSON.stringify(especialidad));
    return [];
  }

  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.slots;

  try {
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) {
      console.log("[horarios-oficiales] fetch no OK:", url, res.status);
      return hit?.slots ?? [];
    }
    const html = await res.text();
    const slots = parseOfficialScheduleHtml(html);
    console.log("[horarios-oficiales] url:", url, "→", slots.length, "slots parseados");
    cache.set(url, { at: Date.now(), slots });
    return slots;
  } catch (err) {
    console.log("[horarios-oficiales] error al traer/parsear", url, err);
    return hit?.slots ?? [];
  }
}

/** Núcleo comparable de un aula: "Aula 115 · Presencial" / "115 " → "115". */
export function normalizeAulaLabel(s: string): string {
  return norm(s)
    .replace(/\baula\b/g, "")
    .replace(/\bpresencial\b|\bvirtual\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
