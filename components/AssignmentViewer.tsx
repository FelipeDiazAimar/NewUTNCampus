"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  File as FileIcon,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import Spinner, { SpinnerBlock } from "@/components/Spinner";
import SubmissionUploader from "@/components/SubmissionUploader";
import { usePdfPreview, type PanelKind } from "@/components/CourseWorkspaceLayout";
import type { AssignInfo, SubmittedFile } from "@/app/api/assign/route";

interface AssignmentViewerProps {
  /** URL del módulo assign en Moodle (mod/assign/view.php?id=…). */
  url: string;
  name: string;
  onClose: () => void;
}

type CommentItem = { user: string; avatar: string; time: string; content: string };

// ─── Helpers de preview de archivos ───────────────────────────────────────────

/** Mapea el tipo/extensión de un archivo entregado a un visor del workspace. */
function panelKindForFile(type: string, name: string): PanelKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (type === "pdf" || ext === "pdf") return "pdf";
  if (type === "document" || ["doc", "docx"].includes(ext)) return "docx";
  if (type === "spreadsheet" || ["xls", "xlsx", "csv"].includes(ext)) return "xlsx";
  if (type === "presentation" || ["ppt", "pptx"].includes(ext)) return "pptx";
  if (["txt", "md", "json"].includes(ext)) return "text";
  return null;
}

// ─── Helpers de tiempo de entrega ──────────────────────────────────────────────

const MESES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
  noviembre: 10, diciembre: 11,
};

/** Parsea fechas de Moodle en español: "viernes, 5 de junio de 2026, 21:17". */
function parseSpanishDate(s: string): Date | null {
  const m = s.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})(?:,?\s*(\d{1,2}):(\d{2}))?/i);
  if (!m) return null;
  const month = MESES[m[2].toLowerCase()];
  if (month === undefined) return null;
  return new Date(+m[3], month, +m[1], +(m[4] ?? 0), +(m[5] ?? 0));
}

/**
 * Tiempo de entrega relativo a la fecha límite.
 * Devuelve la frase y si fue a tiempo (para colorear).
 */
export function deliveryStatus(
  submissionDate: Date,
  dueDate: Date
): { text: string; onTime: boolean } {
  const diff = dueDate.getTime() - submissionDate.getTime(); // >0 = antes (a tiempo)
  const onTime = diff >= 0;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const parts: string[] = [];
  if (days) parts.push(`${days} día${days !== 1 ? "s" : ""}`);
  parts.push(`${hours} hora${hours !== 1 ? "s" : ""}`);
  return {
    text: `La tarea fue enviada ${parts.join(" ")} ${onTime ? "antes" : "después"} de la fecha límite`,
    onTime,
  };
}

function FileTypeIcon({ type }: { type: string }) {
  const map: Record<string, { Icon: typeof FileIcon; color: string }> = {
    spreadsheet: { Icon: FileSpreadsheet, color: "#34c759" },
    pdf: { Icon: FileText, color: "#ff3b30" },
    document: { Icon: FileText, color: "#007aff" },
    image: { Icon: FileImage, color: "#af52de" },
    archive: { Icon: FileArchive, color: "#ff9500" },
  };
  const { Icon, color } = map[type] ?? { Icon: FileIcon, color: "#8e8e93" };
  return (
    <div
      className="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0"
      style={{ backgroundColor: `${color}1a`, color }}
    >
      <Icon className="w-5 h-5" />
    </div>
  );
}

/** Lista agrupada estilo iOS: label izquierda, value derecha. */
function StatusList({ items }: { items: { label: string; value: string; tone?: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] overflow-hidden shadow-sm">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`flex items-start justify-between gap-4 px-4 py-3 ${
            i < items.length - 1 ? "border-b border-[var(--separator)]" : ""
          }`}
        >
          <span className="text-[14px] text-[var(--fg)] shrink-0">{item.label}</span>
          <span
            className="text-[14px] text-right font-medium"
            style={{ color: item.tone ?? "var(--secondary)" }}
          >
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AssignmentViewer({ url, name, onClose }: AssignmentViewerProps) {
  const [info, setInfo] = useState<AssignInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showUploader, setShowUploader] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { openPanel, activeKey } = usePdfPreview();

  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/assign?url=${encodeURIComponent(url)}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "No se pudo cargar la tarea.");
        setInfo(json as AssignInfo);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [url]
  );

  useEffect(() => {
    load();
  }, [load]);

  /** GET de comentarios (comment_ajax.php · action=get · area=submission_comments). */
  const loadComments = useCallback(async () => {
    if (!info?.comments) return;
    setCommentsLoading(true);
    try {
      const res = await fetch("/api/assign/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", meta: info.comments, page: 0 }),
      });
      const json = await res.json();
      setComments(res.ok ? json.comments ?? [] : []);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [info]);

  // Los comentarios se cargan siempre, independiente de si se entregó la tarea.
  useEffect(() => {
    if (info?.comments) loadComments();
  }, [info, loadComments]);

  /** POST de un comentario propio (comment_ajax.php · action=add). */
  async function handleSendComment() {
    const content = commentText.trim();
    if (!content || !info?.comments || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/assign/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", meta: info.comments, content }),
      });
      const json = await res.json();
      if (res.ok) {
        setComments(json.comments ?? comments ?? []);
        setCommentText("");
      }
    } finally {
      setSending(false);
    }
  }

  async function handleUpload(formData: FormData) {
    formData.append("tareaId", info?.cmid ?? "");
    const res = await fetch("/api/assign/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error ?? "No se pudo enviar la entrega.");
    }
    await load({ silent: true });
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch("/api/assign/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmid: info?.cmid }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "No se pudo borrar la entrega.");
      }
      setConfirmDelete(false);
      await load({ silent: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  // Filas de estado normalizadas.
  const submissionVal = info?.rows.find((r) => /estado de (la )?entrega/i.test(r.label))?.value ?? "";
  const gradeVal = info?.rows.find((r) => /calificaci/i.test(r.label))?.value ?? "";
  const lastModVal = info?.rows.find((r) => /última modificaci|ultima modificaci/i.test(r.label))?.value ?? "";
  const timeVal = info?.rows.find((r) => /tiempo restante/i.test(r.label))?.value ?? "";

  // Tiempo de entrega relativo a la fecha límite (solo si la tarea fue entregada).
  const dueDateStr = info?.dates.find((d) => /cierre/i.test(d.label))?.value ?? "";
  let delivery: { text: string; onTime: boolean } | null = null;
  if (info?.submitted && dueDateStr && lastModVal && lastModVal !== "-") {
    const sd = parseSpanishDate(lastModVal);
    const dd = parseSpanishDate(dueDateStr);
    if (sd && dd) delivery = deliveryStatus(sd, dd);
  }

  const statusItems = [
    submissionVal && {
      label: "Estado de la entrega",
      value: submissionVal,
      tone: info?.submitted ? "#34c759" : "#ff9500",
    },
    gradeVal && {
      label: "Calificación",
      value: gradeVal,
      tone: /sin calificar/i.test(gradeVal) ? "#ff9500" : "#34c759",
    },
    lastModVal && lastModVal !== "-" && { label: "Última modificación", value: lastModVal },
    timeVal && { label: "Tiempo restante", value: timeVal },
    delivery && {
      label: "Tiempo de entrega",
      value: delivery.text,
      tone: delivery.onTime ? "#34c759" : "#ff3b30",
    },
  ].filter(Boolean) as { label: string; value: string; tone?: string }[];

  return (
    <div className="flex flex-col h-full bg-[var(--surface)] rounded-2xl border border-[var(--separator)] overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--separator)] bg-[var(--surface)] shrink-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[#34c75922] text-[#34c759]">
          <FileText className="w-[18px] h-[18px]" />
        </div>
        <p className="flex-1 min-w-0 text-[15px] font-semibold text-[var(--fg)] truncate" title={name}>
          {name}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-[var(--surface2)] flex items-center justify-center active:opacity-70 shrink-0"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4 text-[var(--secondary)]" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 bg-[var(--bg)]">
        {loading && <SpinnerBlock label="Cargando tarea…" />}

        {!loading && error && (
          <div className="rounded-2xl border border-[#ffcdd2] bg-[#fff2f2] p-4 text-sm text-[#ff3b30] dark:border-[rgba(255,59,48,0.25)] dark:bg-[rgba(255,59,48,0.08)]">
            {error}
          </div>
        )}

        {!loading && info && (
          <>
            {/* Descripción (texto enriquecido) */}
            {info.description && (
              <section>
                <p className="px-1 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Consigna
                </p>
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] shadow-sm px-4 py-3.5">
                  <div className="prose prose-sm dark:prose-invert max-w-none dark:prose-p:text-[var(--fg)] dark:prose-headings:text-[var(--fg)] dark:prose-li:text-[var(--fg)] prose-p:text-[var(--fg)] prose-li:text-[var(--fg)]">
                    {info.description.split("\n").map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Fechas */}
            {info.dates.length > 0 && (
              <section>
                <p className="px-1 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Fechas
                </p>
                <StatusList items={info.dates.map((d) => ({ label: d.label, value: d.value }))} />
              </section>
            )}

            {/* Estado de la entrega */}
            {statusItems.length > 0 && (
              <section>
                <p className="px-1 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Estado de la entrega
                </p>
                <StatusList items={statusItems} />
              </section>
            )}

            {/* Archivos entregados */}
            {info.files.length > 0 && (
              <section>
                <p className="px-1 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                  Archivos enviados
                </p>
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] overflow-hidden shadow-sm">
                  {info.files.map((file: SubmittedFile, i) => {
                    const kind = panelKindForFile(file.fileType, file.name);
                    const isActive = activeKey === file.url;
                    const rowClass = `w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      isActive ? "bg-[var(--surface2)]" : "active:bg-[var(--surface2)]"
                    } ${i < info.files.length - 1 ? "border-b border-[var(--separator)]" : ""}`;
                    const inner = (
                      <>
                        <FileTypeIcon type={file.fileType} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-medium text-[var(--fg)] truncate">{file.name}</p>
                          {file.time && (
                            <p className="text-[12px] text-[var(--secondary)]">{file.time}</p>
                          )}
                        </div>
                        <ChevronRight
                          className={`w-4 h-4 shrink-0 ${isActive ? "text-[var(--accent)]" : "text-[var(--secondary)]"}`}
                        />
                      </>
                    );
                    // Documentos previsualizables → panel derecho; el resto → descarga.
                    return kind ? (
                      <button
                        key={i}
                        type="button"
                        onClick={() =>
                          openPanel({
                            kind,
                            proxyUrl: `/api/files?url=${encodeURIComponent(file.url)}&inline=1`,
                            fileUrl: file.url,
                            name: file.name,
                          })
                        }
                        className={rowClass}
                      >
                        {inner}
                      </button>
                    ) : (
                      <a
                        key={i}
                        href={`/api/files?url=${encodeURIComponent(file.url)}`}
                        target="_blank"
                        rel="noreferrer"
                        className={rowClass}
                      >
                        {inner}
                      </a>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Comentarios — siempre presentes (independiente de la entrega) */}
            <section>
              <p className="px-1 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
                Comentarios de la entrega
              </p>
              <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] shadow-sm overflow-hidden">
                {commentsLoading ? (
                  <div className="px-4 py-5">
                    <SpinnerBlock label="Cargando comentarios…" size={20} minHeight={60} />
                  </div>
                ) : comments && comments.length > 0 ? (
                  comments.map((c, i) => (
                    <div
                      key={i}
                      className={`px-4 py-3 ${i < comments.length - 1 ? "border-b border-[var(--separator)]" : ""}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px] font-semibold text-[var(--fg)]">{c.user}</span>
                        <span className="text-[11px] text-[var(--secondary)]">{c.time}</span>
                      </div>
                      <div
                        className="text-[13px] text-[var(--fg)] prose prose-sm dark:prose-invert max-w-none dark:prose-p:text-[var(--fg)]"
                        dangerouslySetInnerHTML={{ __html: c.content }}
                      />
                    </div>
                  ))
                ) : (
                  <p className="px-4 py-4 text-[13px] text-[var(--secondary)] text-center">
                    Todavía no hay comentarios.
                  </p>
                )}

                {/* Input de comentario (siempre disponible) */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-t border-[var(--separator)] bg-[var(--surface)]">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSendComment();
                    }}
                    placeholder="Escribí un comentario…"
                    disabled={!info.comments || sending}
                    className="flex-1 bg-transparent text-[14px] text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={handleSendComment}
                    disabled={!commentText.trim() || !info.comments || sending}
                    className="w-9 h-9 rounded-full bg-[#007aff] text-white flex items-center justify-center active:opacity-80 disabled:opacity-40 shrink-0"
                    aria-label="Enviar comentario"
                  >
                    {sending ? <Spinner size={16} color="#ffffff" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {/* Acciones (footer fijo) */}
      {!loading && info && (
        <div className="shrink-0 border-t border-[var(--separator)] bg-[var(--surface)] p-3 flex gap-2.5">
          {info.submitted ? (
            <>
              <button
                type="button"
                onClick={() => setShowUploader(true)}
                className="flex-1 py-3 rounded-2xl bg-[var(--surface2)] text-[var(--fg)] font-semibold text-[14px] active:opacity-80 transition-opacity flex items-center justify-center gap-2"
              >
                <Pencil className="w-[16px] h-[16px]" />
                Editar entrega
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex-1 py-3 rounded-2xl bg-[#ff3b3014] text-[#ff3b30] font-semibold text-[14px] active:opacity-80 transition-opacity flex items-center justify-center gap-2"
              >
                <Trash2 className="w-[16px] h-[16px]" />
                Borrar entrega
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowUploader(true)}
              className="flex-1 py-3 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 transition-opacity"
            >
              Agregar entrega
            </button>
          )}
        </div>
      )}

      {/* Uploader (editar / agregar) */}
      <SubmissionUploader
        open={showUploader}
        onClose={() => setShowUploader(false)}
        itemid={info?.cmid}
        onUpload={handleUpload}
      />

      {/* Modal de confirmación de borrado */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", animation: "fade-in 0.2s ease" }}
          role="dialog"
          aria-modal="true"
        >
          <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={() => !deleting && setConfirmDelete(false)} />
          <div className="relative w-full max-w-[320px] rounded-3xl border border-[var(--separator)] bg-[var(--surface)] p-6 shadow-2xl" style={{ animation: "sheet-pop 0.2s ease-out" }}>
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-[#ff3b3014] flex items-center justify-center mb-3">
                <Trash2 className="w-7 h-7 text-[#ff3b30]" />
              </div>
              <h2 className="text-[17px] font-bold text-[var(--fg)]">Borrar entrega</h2>
              <p className="text-[14px] text-[var(--secondary)] mt-1.5 leading-relaxed">
                ¿Está seguro de que quiere borrar su entrega?
              </p>
              <div className="flex gap-2.5 mt-5 w-full">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="flex-1 py-3 rounded-2xl bg-[var(--surface2)] text-[var(--fg)] font-semibold text-[15px] active:opacity-80 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 py-3 rounded-2xl bg-[#ff3b30] text-white font-semibold text-[15px] active:opacity-80 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {deleting ? <Spinner size={18} color="#ffffff" /> : "Continuar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
