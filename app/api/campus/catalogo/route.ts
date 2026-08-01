import { NextRequest, NextResponse } from "next/server";
import { isGuestRequest } from "@/lib/guest";
import { MOCK_CAMPUS_CATALOGO } from "@/lib/guestMockData";
import {
  extraerAnio,
  normalizarNombre,
  stripTags,
  type CampusCatalogo,
  type CampusCurso,
  type CampusGrupo,
} from "@/lib/campus";

export const runtime = "nodejs";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";
/** Los "Nivel N" acumulan los cursos de todos los ciclos; el default de 20 pagina. */
const PER_PAGE = 200;

interface CatNodo {
  id: string;
  nombre: string;
  depth: number;
}

/**
 * Parsea el árbol de categorías. Moodle lo renderiza anidado y en orden de
 * documento, con data-depth, así que la relación padre/hijo se reconstruye por
 * profundidad + posición (ver hijosDe).
 */
function parseCategorias(html: string): CatNodo[] {
  const out: CatNodo[] = [];
  const re =
    /data-categoryid="(\d+)"\s+data-depth="(\d+)"[\s\S]{0,400}?class="categoryname[^"]*"[\s\S]{0,200}?<a[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const nombre = stripTags(m[3]);
    if (nombre) out.push({ id: m[1], nombre, depth: Number(m[2]) });
  }
  return out;
}

/** Subcategorías directas de un nodo, según el orden de documento. */
function hijosDe(nodos: CatNodo[], idPadre: string): CatNodo[] {
  const i = nodos.findIndex((n) => n.id === idPadre);
  if (i === -1) return [];
  const base = nodos[i].depth;
  const hijos: CatNodo[] = [];
  for (let j = i + 1; j < nodos.length; j++) {
    if (nodos[j].depth <= base) break;
    if (nodos[j].depth === base + 1) hijos.push(nodos[j]);
  }
  return hijos;
}

/** Parsea los coursebox de una página de categoría. */
function parseCursos(html: string): CampusCurso[] {
  const out: CampusCurso[] = [];
  const re = /data-courseid="(\d+)"([\s\S]*?)(?=data-courseid="|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const bloque = m[2];
    const nombreRaw = bloque.match(/class="coursename"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1];
    if (!nombreRaw) continue;
    const nombre = stripTags(nombreRaw);
    if (!nombre) continue;
    out.push({
      id: m[1],
      nombre,
      autoMatriculacion: /fa-key|Auto-matricula/i.test(bloque),
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (isGuestRequest(req)) return NextResponse.json(MOCK_CAMPUS_CATALOGO);

  const token = req.cookies.get("moodle_session_token")?.value;
  if (!token) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const especialidad = req.nextUrl.searchParams.get("especialidad") ?? "";
  const cookie = `MoodleSession=${token}`;
  const anio = new Date().getFullYear();

  const traer = (url: string) =>
    fetch(url, { headers: { Cookie: cookie }, cache: "no-store" }).then((r) => r.text());

  try {
    // El árbol completo viene en la página de categorías. Si esa vista no lo
    // trae (depende de la config del sitio), el front page sí lo hace.
    let arbolHtml = await traer(`${MOODLE_BASE}/course/index.php`);
    let nodos = parseCategorias(arbolHtml);
    if (nodos.length === 0) {
      arbolHtml = await traer(`${MOODLE_BASE}/`);
      nodos = parseCategorias(arbolHtml);
    }

    const objetivo = normalizarNombre(especialidad);
    const carrera = objetivo
      ? nodos.find((n) => normalizarNombre(n.nombre) === objetivo)
      : undefined;

    // Categorías a listar: los "Nivel N" de la carrera + el ciclo corriente de
    // las materias básicas compartidas entre carreras.
    const aListar: CatNodo[] = carrera ? hijosDe(nodos, carrera.id) : [];

    const basicas = nodos.find((n) => /materias basicas/.test(normalizarNombre(n.nombre)));
    if (basicas) {
      const ciclo = hijosDe(nodos, basicas.id).find((c) => extraerAnio(c.nombre) === anio);
      if (ciclo) aListar.push({ ...ciclo, nombre: `Materias básicas ${anio}` });
    }

    const grupos: CampusGrupo[] = [];
    for (const cat of aListar) {
      const html = await traer(
        `${MOODLE_BASE}/course/index.php?categoryid=${cat.id}&perpage=${PER_PAGE}`
      );
      // Solo el ciclo corriente: los Nivel acumulan 2021-2026 y serían ~45 cada
      // uno. Los cursos sin año detectable se conservan, para no esconder una
      // materia que el alumno necesita.
      const cursos = parseCursos(html).filter((c) => {
        const a = extraerAnio(c.nombre);
        return a === null || a === anio;
      });
      if (cursos.length > 0) grupos.push({ categoriaId: cat.id, titulo: cat.nombre, cursos });
    }

    const catalogo: CampusCatalogo = { carrera: carrera?.nombre ?? null, grupos };
    return NextResponse.json(catalogo);
  } catch (err) {
    console.error("[campus-catalogo]", (err as Error).message);
    return NextResponse.json({ error: "No se pudo leer el catálogo del campus." }, { status: 502 });
  }
}
