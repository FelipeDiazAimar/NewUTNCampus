"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { useCourses } from "@/lib/hooks";
import type { MoodleCourse } from "@/lib/moodle";
import { SpinnerBlock } from "@/components/Spinner";

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

  useEffect(() => {
    setUserInfo(getUserInfo());
    if (!document.cookie.includes("moodle_user")) router.push("/");
  }, [router]);

  const filtered: MoodleCourse[] = courses.filter((c) =>
    c.fullname.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar fullname={userInfo.fullname} />

      <main className="max-w-2xl mx-auto px-4 pt-20 pb-6">
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

        {!loading && !error && (
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
      </main>
    </div>
  );
}
