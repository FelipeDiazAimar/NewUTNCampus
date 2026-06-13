"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { useCourses } from "@/lib/hooks";
import { useCursado } from "@/lib/sysacadHooks";
import type { MoodleCourse } from "@/lib/moodle";
import { SpinnerBlock } from "@/components/Spinner";

type MateriasView = "cursando" | "anio";

/** Legajo del alumno (cookie sysacadws_user) — para la llamada de "Cursado actual". */
function getLegajo(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(/sysacadws_user=([^;]+)/);
  if (!m) return undefined;
  try {
    return JSON.parse(decodeURIComponent(m[1]))?.legajo;
  } catch {
    return undefined;
  }
}

function getUserInfo() {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/moodle_user=([^;]+)/);
  if (!m) return {};
  try {
    return JSON.parse(decodeURIComponent(m[1]));
  } catch {
    return {};
  }
}

function formatGreetingName(value?: string) {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
  return normalized.split(" ")[0];
}

/** Normaliza texto para búsquedas: sin acentos/diacríticos y en minúsculas.
 *  Así "matematica" encuentra "Matemática" y viceversa. */
function foldText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Extrae el año de una materia: del título/shortname (ej. "…-2026") o del startdate. */
function extractYear(course: MoodleCourse): string {
  const fromTitle = `${course.fullname} ${course.shortname}`.match(/\b(20\d{2})\b/)?.[1];
  if (fromTitle) return fromTitle;
  if (course.startdate) return String(new Date(course.startdate * 1000).getFullYear());
  return "Otras";
}

/** Agrupa materias por año, en orden descendente ("Otras" al final). */
function groupByYear(courses: MoodleCourse[]): [string, MoodleCourse[]][] {
  const map = new Map<string, MoodleCourse[]>();
  for (const c of courses) {
    const year = extractYear(c);
    if (!map.has(year)) map.set(year, []);
    map.get(year)!.push(c);
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === "Otras") return 1;
    if (b[0] === "Otras") return -1;
    return b[0].localeCompare(a[0], "es", { numeric: true });
  });
}

const ICON_COLORS: [string, string][] = [
  ["#007aff", "#e8f4fd"],
  ["#34c759", "#e8f8ed"],
  ["#ff9500", "#fff3e0"],
  ["#af52de", "#f3e8ff"],
  ["#ff3b30", "#ffe8e7"],
  ["#5ac8fa", "#e0f7ff"],
];

function CourseIcon({ name, index }: { name: string; index: number }) {
  const [fg, bg] = ICON_COLORS[index % ICON_COLORS.length];
  const initials =
    name
      .split(" ")
      .filter((w) => w.length > 2)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || name.slice(0, 2).toUpperCase();
  return (
    <div
      className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0 text-[13px] font-bold"
      style={{ background: bg, color: fg }}
    >
      {initials}
    </div>
  );
}

function CourseRow({ course, index }: { course: MoodleCourse; index: number }) {
  return (
    <Link href={`/course/${course.id}`}>
      <div className="flex items-center gap-3.5 px-4 py-3 hover:bg-[var(--surface2)] active:bg-[var(--surface2)] transition-colors cursor-pointer">
        <CourseIcon name={course.fullname} index={index} />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-[var(--fg)] truncate leading-snug">
            {course.fullname}
          </p>
          <p className="text-[12px] text-[var(--secondary)] mt-0.5">
            {course.coursecategory}
          </p>
        </div>
        <svg
          className="w-4 h-4 text-[#c7c7cc] dark:text-[var(--secondary)] shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </div>
    </Link>
  );
}

export default function MateriasPage() {
  const router = useRouter();
  const { courses, loading, error } = useCourses();
  const [userInfo, setUserInfo] = useState<{ fullname?: string; username?: string }>({});
  const [search, setSearch] = useState("");
  const [view, setView] = useState<MateriasView>("anio");
  const [legajo, setLegajo] = useState<string | undefined>(undefined);

  useEffect(() => {
    setUserInfo(getUserInfo());
    if (!document.cookie.includes("moodle_user")) { router.push("/"); return; }

    const lj = getLegajo();
    setLegajo(lj);
    // Vista inicial: ?view= manda; si no, "cursando" sólo si hay sesión sysacad.
    const param = new URLSearchParams(window.location.search).get("view");
    if (param === "cursando" || param === "anio") setView(param);
    else setView(lj ? "cursando" : "anio");
  }, [router]);

  // "Cursado actual" desde sysacad (mismo endpoint que /sysacad).
  const { data: cursado, isLoading: cursadoLoading } = useCursado(legajo);

  // Vínculo materia-en-curso ↔ curso de Moodle: ClaveCampusVirtual === shortname
  // (match exacto), con fallback por nombre (NombreMateria ⊂ fullname).
  const isCursando = useMemo(() => {
    const claves = new Set(
      (cursado?.Comisiones ?? [])
        .map((c) => c.ClaveCampusVirtual?.trim().toLowerCase())
        .filter((v): v is string => !!v)
    );
    const nombres = (cursado?.Comisiones ?? [])
      .map((c) => foldText(c.NombreMateria ?? ""))
      .filter(Boolean);
    return (course: MoodleCourse) => {
      const sn = course.shortname?.trim().toLowerCase();
      if (sn && claves.has(sn)) return true;
      const fn = foldText(course.fullname);
      return nombres.some((n) => fn.includes(n));
    };
  }, [cursado]);

  const needle = foldText(search);
  const filtered: MoodleCourse[] = needle
    ? courses.filter((c) =>
        foldText(`${c.fullname} ${c.shortname} ${c.coursecategory}`).includes(needle)
      )
    : courses;

  const cursandoCourses = useMemo(() => filtered.filter(isCursando), [filtered, isCursando]);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar fullname={userInfo.fullname} />

      <main className="max-w-2xl mx-auto px-4 pt-6 pb-6">
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Materias" }]} />

        {/* Greeting */}
        <div className="mb-5">
          <div className="bg-[var(--surface)] border border-[var(--separator)] rounded-3xl px-5 py-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-[26px] font-bold text-[var(--fg)] tracking-tight">
                  {formatGreetingName(userInfo.fullname || userInfo.username)
                    ? `Bienvenido, ${formatGreetingName(userInfo.fullname || userInfo.username)}`
                    : "Mis materias"}
                </h1>
                <p className="text-[14px] text-[var(--secondary)] mt-0.5">
                  Tu campus listo para empezar la semana.
                </p>
              </div>
              <div
                className="hidden sm:flex items-center gap-2 rounded-full px-3 py-1.5"
                style={{ background: "var(--accent-light)", color: "var(--accent)" }}
              >
                <span className="text-[12px] font-semibold">Hoy</span>
                <span className="text-[12px] opacity-80">📚</span>
              </div>
            </div>
            {!loading && (
              <div className="mt-3 flex items-center gap-2 text-[13px] text-[var(--secondary)]">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                  style={{ background: "var(--surface2)" }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "#34c759" }}
                  />
                  {courses.length} materia{courses.length !== 1 ? "s" : ""} activa
                  {courses.length !== 1 ? "s" : ""}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                  style={{ background: "var(--surface2)" }}
                >
                  Acceso directo a secciones y archivos
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--secondary)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar materia…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--separator)] text-[15px] text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none focus:border-[var(--accent)] transition-colors shadow-sm"
          />
        </div>

        {/* Toggle Cursando / Por año (segmented control estilo Apple) */}
        <div className="relative flex mb-4 p-1 rounded-full bg-[var(--surface2)] select-none">
          <span
            aria-hidden
            className="absolute top-1 bottom-1 rounded-full bg-[#007aff] shadow-sm transition-transform duration-300 ease-out"
            style={{
              left: "0.25rem",
              width: "calc(50% - 0.25rem)",
              transform: view === "anio" ? "translateX(100%)" : "translateX(0)",
            }}
          />
          {([
            ["cursando", "Cursando"],
            ["anio", "Por año"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`relative z-10 flex-1 py-1.5 text-[14px] font-semibold rounded-full transition-colors duration-200 ${
                view === key ? "text-white" : "text-[var(--secondary)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="bg-[var(--surface)] rounded-2xl shadow-sm overflow-hidden">
            <SpinnerBlock label="Cargando materias…" size={30} minHeight={180} />
          </div>
        )}

        {error && (
          <div className="bg-[#fff2f2] dark:bg-[rgba(255,59,48,0.08)] border border-[#ffcdd2] dark:border-[rgba(255,59,48,0.25)] rounded-2xl p-5 text-[#ff3b30] text-sm">
            Error al cargar materias: {error}
          </div>
        )}

        {!loading && !error && view === "anio" && (
          <>
            {filtered.length === 0 ? (
              <p className="text-center py-16 text-[var(--secondary)] text-[15px]">
                {search
                  ? "Sin resultados para esa búsqueda."
                  : "No tenés materias inscriptas."}
              </p>
            ) : (
              <div className="space-y-6">
                {groupByYear(filtered).map(([year, list]) => (
                  <section key={year}>
                    <p className="px-1 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                      {year}
                    </p>
                    <div className="bg-[var(--surface)] rounded-2xl overflow-hidden shadow-sm divide-y divide-[var(--separator)] border border-[var(--separator)]">
                      {list.map((course, i) => (
                        <CourseRow key={course.id} course={course} index={i} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}

        {!loading && !error && view === "cursando" && (
          <>
            {!legajo ? (
              /* Sin sesión de Sysacad: pedir login y volver acá ya en vista Cursando */
              <div className="bg-[var(--surface)] border border-[var(--separator)] rounded-2xl shadow-sm px-6 py-10 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: "var(--accent-light)" }}>
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#007aff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                </div>
                <p className="text-[16px] font-semibold text-[var(--fg)]">Iniciá sesión en Sysacad</p>
                <p className="text-[14px] text-[var(--secondary)] mt-1 max-w-xs">
                  Debes de iniciar sesión en Sysacad para ver las materias que estás cursando.
                </p>
                <Link
                  href={`/sysacad?next=${encodeURIComponent("/materias?view=cursando")}`}
                  className="mt-5 inline-flex items-center justify-center rounded-full bg-[#007aff] px-5 py-2.5 text-[15px] font-semibold text-white shadow-sm transition-opacity active:opacity-80"
                >
                  Iniciar sesión en Sysacad
                </Link>
              </div>
            ) : cursadoLoading && !cursado ? (
              <div className="bg-[var(--surface)] rounded-2xl shadow-sm overflow-hidden">
                <SpinnerBlock label="Buscando tus materias en curso…" size={30} minHeight={180} />
              </div>
            ) : cursandoCourses.length === 0 ? (
              <p className="text-center py-16 text-[var(--secondary)] text-[15px]">
                {search
                  ? "Sin resultados para esa búsqueda."
                  : "No pudimos determinar tus materias en curso. Probá la vista “Por año”."}
              </p>
            ) : (
              <div className="bg-[var(--surface)] rounded-2xl overflow-hidden shadow-sm divide-y divide-[var(--separator)] border border-[var(--separator)]">
                {cursandoCourses.map((course, i) => (
                  <CourseRow key={course.id} course={course} index={i} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
