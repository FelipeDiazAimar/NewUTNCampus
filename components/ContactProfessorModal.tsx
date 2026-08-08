"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, X } from "lucide-react";
import Spinner from "@/components/Spinner";
import { avatarColor, getInitials } from "@/lib/chat";
import type { Professor } from "@/lib/participants";

interface Props {
  courseId: number;
  open: boolean;
  onClose: () => void;
}

function ProfessorAvatar({ name, url }: { name: string; url: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} className="h-12 w-12 rounded-full object-cover shrink-0" />
  ) : (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ backgroundColor: avatarColor(name), fontSize: 16 }}
    >
      {getInitials(name)}
    </div>
  );
}

export default function ContactProfessorModal({ courseId, open, onClose }: Props) {
  const router = useRouter();
  const [professors, setProfessors] = useState<Professor[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProfessors(null);
    setError(false);
    fetch(`/api/participants?id=${courseId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((data: { professors: Professor[] }) => setProfessors(data.professors))
      .catch(() => setError(true));
  }, [open, courseId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function goToChat(professorId: number) {
    onClose();
    router.push(`/chat?userid=${professorId}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", animation: "fade-in 0.2s ease" }}
      role="dialog"
      aria-modal="true"
    >
      <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={onClose} />

      <div className="relative w-full max-w-[360px] rounded-3xl border border-[var(--separator)] bg-[var(--surface)]/90 backdrop-blur-xl p-6 shadow-2xl max-h-[80vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 w-8 h-8 rounded-full bg-[var(--surface2)] flex items-center justify-center active:opacity-70"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4 text-[var(--secondary)]" />
        </button>

        <h2 className="text-[18px] font-bold text-[var(--fg)] tracking-tight mb-4">
          Contactar Profesor
        </h2>

        {professors === null && !error && (
          <div className="flex justify-center py-8">
            <Spinner size={28} />
          </div>
        )}

        {error && (
          <p className="text-[14px] text-[var(--secondary)] text-center py-8">
            No se pudo cargar la lista de profesores.
          </p>
        )}

        {professors !== null && !error && professors.length === 0 && (
          <p className="text-[14px] text-[var(--secondary)] text-center py-8">
            No se encontraron profesores para esta materia.
          </p>
        )}

        {professors !== null && professors.length > 0 && (
          <div className="flex flex-col gap-2">
            {professors.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-[var(--surface2)] p-3">
                <ProfessorAvatar name={p.name} url={p.avatarUrl} />
                <p className="flex-1 min-w-0 truncate text-[15px] font-semibold text-[var(--fg)]">{p.name}</p>
                <button
                  type="button"
                  onClick={() => goToChat(p.id)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#007aff] px-3.5 py-2 text-[13px] font-semibold text-white active:opacity-80"
                >
                  <MessageCircle className="w-4 h-4" />
                  Comunicarte
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
