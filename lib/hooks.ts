"use client";

import { useState, useEffect, useCallback } from "react";
import type { MoodleCourse, MoodleCourseSection } from "./moodle";
import type {
  SysacadRecurso,
  MateriaEstado,
  MateriaCorrelativa,
  MateriaPlan,
  MateriaCursando,
} from "./sysacad";

type CourseContentsCache = {
  sections: MoodleCourseSection[];
  courseName: string;
};

let cachedCourses: MoodleCourse[] | null = null;
const cachedCourseContents = new Map<number, CourseContentsCache>();

async function fetchCoursesFromScrape(): Promise<MoodleCourse[]> {
  const res = await fetch("/api/courses");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return Array.isArray(json.data) ? json.data : [];
}

async function fetchCoursesFromApi(userId?: number): Promise<MoodleCourse[]> {
  try {
    const res = await fetch("/api/moodle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        methodname:
          "core_course_get_enrolled_courses_by_timeline_classification",
        args: {
          offset: 0,
          limit: 0,
          classification: "all",
          customfieldname: "",
          customfieldvalue: "",
          searchvalue: "",
        },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    const courses = json.data.courses ?? [];
    if (courses.length > 0 || !userId) return courses;

    const fallback = await fetch("/api/moodle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        methodname: "core_enrol_get_users_courses",
        args: { userid: userId },
      }),
    });
    const fallbackJson = await fallback.json();
    if (!fallback.ok) throw new Error(fallbackJson.error);
    const fallbackCourses = Array.isArray(fallbackJson.data) ? fallbackJson.data : [];
    if (fallbackCourses.length > 0) return fallbackCourses;
  } catch {
    // Ignore and fall back to HTML scrape.
  }

  return fetchCoursesFromScrape();
}

async function fetchCourseContentsFromApi(courseId: number): Promise<CourseContentsCache> {
  const res = await fetch(`/api/course?id=${courseId}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return {
    sections: Array.isArray(json.data) ? json.data : [],
    courseName: json.courseName ?? "",
  };
}

export function clearCourseCache() {
  cachedCourses = null;
  cachedCourseContents.clear();
}

export function useCourses() {
  const [courses, setCourses] = useState<MoodleCourse[]>(cachedCourses ?? []);
  const [loading, setLoading] = useState(!cachedCourses);
  const [error, setError] = useState<string | null>(null);

  const getUserId = useCallback((): number | undefined => {
    if (typeof document === "undefined") return undefined;
    const match = document.cookie.match(/moodle_user=([^;]+)/);
    if (!match) return undefined;
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1])) as { userid?: number };
      return parsed.userid;
    } catch {
      return undefined;
    }
  }, []);

  const fetch_ = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const nextCourses = await fetchCoursesFromApi(getUserId());
      cachedCourses = nextCourses;
      setCourses(nextCourses);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cachedCourses) return;
    fetch_();
  }, [fetch_]);

  return { courses, loading, error, refetch: fetch_ };
}

export function useCourseContents(courseId: number) {
  const cached = cachedCourseContents.get(courseId);
  const [sections, setSections] = useState<MoodleCourseSection[]>(cached?.sections ?? []);
  const [courseName, setCourseName] = useState<string>(cached?.courseName ?? "");
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    const existing = cachedCourseContents.get(courseId);
    if (existing) {
      setSections(existing.sections);
      setCourseName(existing.courseName);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // core_course_get_contents is blocked on this Moodle instance (servicenotavailable).
    // Scrape the course page directly instead.
    fetchCourseContentsFromApi(courseId)
      .then((data) => {
        cachedCourseContents.set(courseId, data);
        setSections(data.sections);
        setCourseName(data.courseName);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [courseId]);

  return { sections, courseName, loading, error };
}

// ─── Sysacad ────────────────────────────────────────────────────────────────

/** Mapea cada recurso a su tipo de fila, para tipar el hook según el recurso. */
type SysacadDataMap = {
  estado: MateriaEstado;
  correlatividades: MateriaCorrelativa;
  materias: MateriaPlan;
  notas: MateriaCursando;
};

type SysacadResponse<R extends SysacadRecurso> = {
  titulo: string;
  alumno: string;
  data: SysacadDataMap[R][];
};

/**
 * Trae un recurso de Sysacad (`estado`, `correlatividades`, `materias`, `notas`)
 * desde `GET /api/sysacad/[recurso]`.  Devuelve `{ data, titulo, alumno, loading, error }`.
 * Un 401 (sesión Sysacad expirada) se expone como `expired` para que la pantalla
 * pueda mandar al login de Sysacad.
 */
export function useSysacadData<R extends SysacadRecurso>(recurso: R) {
  const [data, setData] = useState<SysacadDataMap[R][]>([]);
  const [titulo, setTitulo] = useState("");
  const [alumno, setAlumno] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpired(false);
    try {
      const res = await fetch(`/api/sysacad/${recurso}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 401) setExpired(true);
        throw new Error(json.error ?? "No se pudo cargar la información.");
      }
      const payload = json as SysacadResponse<R>;
      setData(payload.data ?? []);
      setTitulo(payload.titulo ?? "");
      setAlumno(payload.alumno ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [recurso]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, titulo, alumno, loading, error, expired, refetch: load };
}
