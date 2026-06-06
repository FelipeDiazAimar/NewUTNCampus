"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
import AssignmentStatusList from "@/components/AssignmentStatusList";
import SubmissionUploader from "@/components/SubmissionUploader";
import type { AssignInfo } from "@/app/api/assign/route";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

export default function TareaPage({
  params,
}: {
  params: Promise<{ materiaId: string; tareaId: string }>;
}) {
  const { materiaId, tareaId } = use(params);
  const router = useRouter();

  const [info, setInfo] = useState<AssignInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showUploader, setShowUploader] = useState(false);

  const loadAssignment = useCallback(
    async (opts?: { silent?: boolean }) => {
      const assignUrl = `${MOODLE_BASE}/mod/assign/view.php?id=${tareaId}`;
      if (!opts?.silent) setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/assign?url=${encodeURIComponent(assignUrl)}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "No se pudo cargar la tarea.");
        setInfo(json as AssignInfo);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [tareaId]
  );

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) {
      router.push("/");
      return;
    }
    loadAssignment();
  }, [loadAssignment, router]);

  /**
   * Punto de integración con el backend. El uploader arma el FormData
   * (archivos + itemid); acá lo reenviamos al Route Handler que hablará con
   * `repository/draftfiles_ajax.php`.  (Route Handler pendiente de crear.)
   */
  const handleUpload = useCallback(
    async (formData: FormData) => {
      formData.append("tareaId", tareaId);
      const res = await fetch("/api/assign/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "No se pudo enviar la entrega.");
      }
      // Refrescar el estado de la entrega tras subir.
      await loadAssignment({ silent: true });
    },
    [tareaId, loadAssignment]
  );

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />

      <main className="max-w-2xl mx-auto px-4 pt-20 pb-28">
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Materias", href: "/materias" },
            { label: "Materia", href: `/course/${materiaId}` },
            { label: info?.title || "Tarea" },
          ]}
        />

        {loading && <SpinnerBlock label="Cargando tarea…" />}

        {!loading && error && (
          <div className="rounded-2xl border border-[#ffcdd2] bg-[#fff2f2] p-4 text-sm text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]">
            {error}
          </div>
        )}

        {!loading && !error && info && (
          <>
            {/* Encabezado */}
            <div className="flex items-start gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm bg-[#007aff1a] text-[#007aff]">
                <FileText className="w-6 h-6" />
              </div>
              <h1 className="text-[24px] font-bold text-[var(--fg)] tracking-tight leading-tight pt-1">
                {info.title}
              </h1>
            </div>

            {/* Descripción (texto enriquecido, renderizado de forma segura) */}
            {info.description && (
              <section className="mb-5">
                <p className="px-1 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Descripción
                </p>
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] shadow-sm px-4 py-3.5">
                  <div className="prose dark:prose-invert max-w-none text-[15px] text-[var(--fg)]">
                    {info.description.split("\n").map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Estado de la entrega (lista agrupada iOS) */}
            <AssignmentStatusList dates={info.dates} rows={info.rows} />
          </>
        )}
      </main>

      {/* Botón destacado "Agregar entrega" (fijo abajo, glass) */}
      {!loading && !error && info && (
        <div className="fixed bottom-0 inset-x-0 z-30 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)] to-transparent">
          <div className="max-w-2xl mx-auto">
            <button
              type="button"
              onClick={() => setShowUploader(true)}
              className="w-full py-3.5 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 transition-opacity shadow-lg flex items-center justify-center gap-2"
            >
              <Plus className="w-[18px] h-[18px]" />
              Agregar entrega
            </button>
          </div>
        </div>
      )}

      <SubmissionUploader
        open={showUploader}
        onClose={() => setShowUploader(false)}
        onUpload={handleUpload}
      />
    </div>
  );
}
