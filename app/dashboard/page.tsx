"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
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
      <div className="flex items-center gap-3.5 px-4 py-3 active:bg-[#f2f2f7] transition-colors cursor-pointer">
        <CourseIcon name={course.fullname} index={index} />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-[#1c1c1e] truncate leading-snug">
            {course.fullname}
          </p>
          <p className="text-[12px] text-[#6c6c70] mt-0.5">
            {course.coursecategory}
          </p>
        </div>
        <svg
          className="w-4 h-4 text-[#c7c7cc] shrink-0"
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

export default function DashboardPage() {
  const router = useRouter();
  const { courses, loading, error } = useCourses();
  const [userInfo, setUserInfo] = useState<{ fullname?: string }>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    setUserInfo(getUserInfo());
    if (!document.cookie.includes("moodle_user")) router.push("/");
  }, [router]);

  const filtered: MoodleCourse[] = courses.filter((c) =>
    c.fullname.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#f2f2f7]">
      <Navbar fullname={userInfo.fullname} />

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Greeting */}
        <div className="mb-5">
          <h1 className="text-[28px] font-bold text-[#1c1c1e] tracking-tight">
            {userInfo.fullname
              ? `Hola, ${userInfo.fullname.split(" ")[0]}`
              : "Mis materias"}
          </h1>
          {!loading && (
            <p className="text-[14px] text-[#6c6c70] mt-0.5">
              {courses.length} materia{courses.length !== 1 ? "s" : ""} activa
              {courses.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8e8e93]"
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
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-[rgba(60,60,67,0.12)] text-[15px] text-[#1c1c1e] placeholder:text-[#c7c7cc] outline-none focus:border-[#007aff] transition-colors shadow-sm"
          />
        </div>

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <SpinnerBlock label="Cargando materias…" size={30} minHeight={180} />
          </div>
        )}

        {error && (
          <div className="bg-[#fff2f2] border border-[#ffcdd2] rounded-2xl p-5 text-[#ff3b30] text-sm">
            Error al cargar materias: {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {filtered.length === 0 ? (
              <p className="text-center py-16 text-[#6c6c70] text-[15px]">
                {search
                  ? "Sin resultados para esa búsqueda."
                  : "No tenés materias inscriptas."}
              </p>
            ) : (
              <div className="bg-white rounded-2xl overflow-hidden shadow-sm divide-y divide-[rgba(60,60,67,0.1)]">
                {filtered.map((course, i) => (
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
