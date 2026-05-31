"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  Box,
  GraduationCap,
  HelpCircle,
  MessageSquare,
  Settings,
  UserCheck,
  Video,
} from "lucide-react";
import Navbar from "@/components/Navbar";

type HomeItem = {
  type: "widget" | "app";
  title: string;
  href: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: string;
  muted?: boolean;
  popup?: boolean;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  rowMd?: number;
  colMd?: number;
  rowSpanMd?: number;
  colSpanMd?: number;
};

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

export default function DashboardPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<{ fullname?: string }>({});
  const [popupItem, setPopupItem] = useState<HomeItem | null>(null);

  useEffect(() => {
    setUserInfo(getUserInfo());
    if (!document.cookie.includes("moodle_user")) router.push("/");
  }, [router]);

  const items = useMemo<HomeItem[]>(
    () => [
      {
        type: "widget",
        title: "Materias",
        subtitle: "Tus cursos, secciones y archivos",
        href: "/materias",
        icon: BookOpen,
        tone: "#007aff",
        row: 1,
        col: 1,
        rowSpan: 2,
        colSpan: 2,
        rowMd: 1,
        colMd: 1,
        rowSpanMd: 2,
        colSpanMd: 2,
      },
      {
        type: "app",
        title: "Configuracion",
        href: "#",
        icon: Settings,
        tone: "#8e8e93",
        popup: true,
        row: 1,
        col: 3,
        rowSpan: 1,
        colSpan: 1,
        rowMd: 1,
        colMd: 3,
        rowSpanMd: 1,
        colSpanMd: 1,
      },
      {
        type: "app",
        title: "Notificaciones",
        href: "/notificaciones",
        icon: Bell,
        tone: "#ff9500",
        row: 2,
        col: 3,
        rowSpan: 1,
        colSpan: 1,
        popup: false,
        rowMd: 1,
        colMd: 4,
        rowSpanMd: 1,
        colSpanMd: 1,
      },
      {
        type: "app",
        title: "Foro",
        href: "#",
        icon: MessageSquare,
        tone: "#5ac8fa",
        popup: true,
        row: 3,
        col: 1,
        rowSpan: 1,
        colSpan: 1,
        rowMd: 3,
        colMd: 1,
        rowSpanMd: 1,
        colSpanMd: 1,
      },
      {
        type: "app",
        title: "Preguntas Frecuentes",
        href: "#",
        icon: HelpCircle,
        tone: "#34c759",
        popup: true,
        row: 4,
        col: 1,
        rowSpan: 1,
        colSpan: 1,
        rowMd: 3,
        colMd: 2,
        rowSpanMd: 1,
        colSpanMd: 1,
      },
      {
        type: "app",
        title: "Tutoriales",
        href: "#",
        icon: Video,
        tone: "#ff2d55",
        popup: true,
        row: 5,
        col: 3,
        rowSpan: 1,
        colSpan: 1,
        rowMd: 3,
        colMd: 5,
        rowSpanMd: 1,
        colSpanMd: 1,
      },
      {
        type: "app",
        title: "Proximamente",
        href: "#",
        icon: Box,
        muted: true,
        popup: true,
        row: 6,
        col: 3,
        rowSpan: 1,
        colSpan: 1,
        rowMd: 3,
        colMd: 6,
        rowSpanMd: 1,
        colSpanMd: 1,
      },
      {
        type: "widget",
        title: "Asistencia",
        subtitle: "Control rapido y constancias",
        href: "#",
        icon: UserCheck,
        tone: "#34c759",
        popup: true,
        row: 3,
        col: 2,
        rowSpan: 2,
        colSpan: 2,
        rowMd: 2,
        colMd: 3,
        rowSpanMd: 2,
        colSpanMd: 2,
      },
      {
        type: "widget",
        title: "Sysacad (Notas)",
        subtitle: "Seguimiento de parciales",
        href: "#",
        icon: GraduationCap,
        tone: "#af52de",
        popup: true,
        row: 5,
        col: 1,
        rowSpan: 2,
        colSpan: 2,
        rowMd: 1,
        colMd: 5,
        rowSpanMd: 2,
        colSpanMd: 2,
      },
    ],
    []
  );

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar fullname={userInfo.fullname} />

      <main
        className="springboard-scroll relative w-full px-0 pt-16 pb-10 -mt-16 overflow-x-hidden overflow-y-auto"
        style={{
          "--cell": "min(110px, calc((100vw - 24px) / 3))",
          "--cell-md": "112px",
          "--gap": "10px",
          "--gap-md": "12px",
          "--cols": "3",
          "--cols-md": "6",
        } as CSSProperties}
      >
        <div className="pointer-events-none absolute -top-12 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full blur-3xl opacity-70" style={{ background: "radial-gradient(circle at 30% 30%, rgba(0,122,255,0.35), transparent 70%)" }} />
        <div className="pointer-events-none absolute top-32 -right-10 h-56 w-56 rounded-full blur-3xl opacity-60" style={{ background: "radial-gradient(circle at 30% 30%, rgba(90,200,250,0.35), transparent 70%)" }} />
        <div className="springboard-wrap px-0 md:px-6">
          <div className="mb-6 mt-4">
            <p className="text-[12px] uppercase tracking-[0.28em] text-[var(--secondary)]">
              Inicio
            </p>
            <h1 className="text-[28px] font-bold text-[var(--fg)] tracking-tight mt-1">
              {userInfo.fullname
                ? `Hola, ${userInfo.fullname.split(" ")[0]}`
                : "Campus UTN"}
            </h1>
            <p className="text-[14px] text-[var(--secondary)] mt-1">
              Todo al alcance de tu mano.
            </p>
          </div>

          <div
            className="springboard-grid relative"
          >
          {items.map((item) => {
            const Icon = item.icon;
            const isWidget = item.type === "widget";
            const baseClass =
              "group relative overflow-hidden border border-[var(--navbar-border)] shadow-sm backdrop-blur-md transition-transform duration-200 active:scale-95 hover:bg-[rgba(0,0,0,0.04)] dark:hover:bg-[rgba(255,255,255,0.06)]";
            const sizeClass = isWidget
              ? "col-span-2 row-span-2 rounded-3xl p-4"
              : "col-span-1 row-span-1 rounded-[22%] p-3";
            const mutedClass = item.muted
              ? "bg-transparent border-2 border-dashed border-[var(--separator)]"
              : "bg-[var(--surface)]";

            return (
              <Link
                key={`${item.type}-${item.title}`}
                href={item.href}
                className={`springboard-item ${baseClass} ${sizeClass} ${mutedClass}`}
                style={{
                  "--row": item.row,
                  "--col": item.col,
                  "--row-span": item.rowSpan,
                  "--col-span": item.colSpan,
                  "--row-md": item.rowMd ?? item.row,
                  "--col-md": item.colMd ?? item.col,
                  "--row-span-md": item.rowSpanMd ?? item.rowSpan,
                  "--col-span-md": item.colSpanMd ?? item.colSpan,
                } as CSSProperties}
                onClick={(event) => {
                  if (!item.popup) return;
                  event.preventDefault();
                  setPopupItem(item);
                }}
              >
                <div className={isWidget ? "flex flex-col h-full" : "flex flex-col items-center justify-center h-full"}>
                  <div
                    className={isWidget ? "mb-auto" : "mb-2"}
                    style={{ color: item.tone ?? "var(--accent)" }}
                  >
                    <Icon className={isWidget ? "w-[34px] h-[34px]" : "w-5 h-5"} />
                  </div>

                  <div className={isWidget ? "mt-auto" : "text-center"}>
                    <p className={isWidget ? "text-[15px] font-semibold text-[var(--fg)]" : "text-[11px] font-semibold text-[var(--fg)]"}>
                      {item.title}
                    </p>
                    {isWidget && item.subtitle && (
                      <p className="text-[12px] text-[var(--secondary)] mt-1">
                        {item.subtitle}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        </div>
      </main>

      {popupItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0, 0, 0, 0.45)" }}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Cerrar"
            onClick={() => setPopupItem(null)}
          />
          <div className="relative w-full max-w-sm rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] p-5 shadow-lg">
            <div className="flex items-center justify-center mb-4" style={{ color: popupItem.tone ?? "var(--accent)" }}>
              <popupItem.icon className="w-8 h-8" />
            </div>
            <h2 className="text-[18px] font-semibold text-[var(--fg)] text-center">
              {popupItem.title}
            </h2>
            <p className="text-[14px] text-[var(--secondary)] text-center mt-2">
              Proximamente, estamos trabajando en ello.
            </p>
            <button
              type="button"
              className="mt-5 w-full rounded-2xl bg-[var(--surface2)] py-2.5 text-[14px] font-semibold text-[var(--fg)] hover:opacity-90"
              onClick={() => setPopupItem(null)}
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
