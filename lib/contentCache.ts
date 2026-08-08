import { supabaseFetch } from "@/lib/supabase";
import type { MoodleCourse, MoodleCourseSection } from "@/lib/moodle";

/**
 * Respaldo de solo-lectura del campus viejo (Moodle) en Supabase
 * (`moodle_cache`): una tabla clave-valor genérica que guarda la última
 * respuesta exitosa de cada recurso, para poder seguir mostrando contenido
 * ya visto cuando Moodle no responde (caída, mantenimiento, red).
 *
 * `course:<id>` se comparte entre todos los alumnos de esa materia (la
 * estructura de secciones/módulos no depende de quién la pide).
 * `courses:<userId>` es por usuario (cada uno está inscripto en cursos
 * distintos).
 *
 * Todo es best-effort, igual que `lib/deviceSessions.ts`: si Supabase falla
 * o la tabla no existe, las funciones degradan en silencio — nunca deben
 * romper una respuesta que de otra forma sería exitosa (escritura) ni
 * inventar un error nuevo (lectura, donde `null` significa "no hay
 * respaldo, seguí con el error original").
 */

const TABLE = "moodle_cache";

export type CachedCourse = {
  sections: MoodleCourseSection[];
  courseName: string;
};

function courseKey(courseId: number): string {
  return `course:${courseId}`;
}

function coursesKey(userId: number): string {
  return `courses:${userId}`;
}

async function readPayload<T>(cacheKey: string): Promise<T | null> {
  try {
    const res = await supabaseFetch(
      `${TABLE}?cache_key=eq.${encodeURIComponent(cacheKey)}&select=payload`
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { payload: T }[];
    return rows[0]?.payload ?? null;
  } catch {
    return null;
  }
}

async function writePayload(cacheKey: string, payload: unknown): Promise<void> {
  try {
    await supabaseFetch(`${TABLE}?on_conflict=cache_key`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        cache_key: cacheKey,
        payload,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    /* best-effort */
  }
}

export async function getCachedCourse(courseId: number): Promise<CachedCourse | null> {
  return readPayload<CachedCourse>(courseKey(courseId));
}

/** Fire-and-forget: no se espera en el camino de lectura ni de escritura. */
export function setCachedCourse(courseId: number, data: CachedCourse): void {
  void writePayload(courseKey(courseId), data);
}

export async function getCachedCourses(userId: number): Promise<MoodleCourse[] | null> {
  return readPayload<MoodleCourse[]>(coursesKey(userId));
}

/** Fire-and-forget: no se espera en el camino de lectura ni de escritura. */
export function setCachedCourses(userId: number, courses: MoodleCourse[]): void {
  void writePayload(coursesKey(userId), courses);
}
