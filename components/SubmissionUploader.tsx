"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { File as FileIcon, UploadCloud, X } from "lucide-react";
import Spinner from "@/components/Spinner";

const MB = 1024 * 1024;
export const MAX_BYTES = 20 * MB;
export const MAX_FILES = 20;

interface SubmissionUploaderProps {
  open: boolean;
  onClose: () => void;
  /** itemid del draft de Moodle (files_filemanager). Necesario para el upload real. */
  itemid?: string | number;
  maxBytes?: number;
  maxFiles?: number;
  /**
   * Hook de subida. Recibe el FormData ya armado (archivos + itemid). Si no se
   * provee, `handleUpload` solo arma el FormData y lo deja listo (modo preparación).
   */
  onUpload?: (formData: FormData) => Promise<void>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** Identidad estable para deduplicar archivos en la cola. */
const fileKey = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;

export default function SubmissionUploader({
  open,
  onClose,
  itemid,
  maxBytes = MAX_BYTES,
  maxFiles = MAX_FILES,
  onUpload,
}: SubmissionUploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  // Reset al cerrar.
  useEffect(() => {
    if (!open) {
      setFiles([]);
      setError("");
      setUploading(false);
    }
  }, [open]);

  // Cerrar con Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !uploading && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, uploading, onClose]);

  const onDrop = useCallback(
    (accepted: File[], rejections: FileRejection[]) => {
      setError("");
      if (rejections.length) {
        const tooBig = rejections.some((r) => r.errors.some((e) => e.code === "file-too-large"));
        setError(
          tooBig
            ? `Algún archivo supera los ${formatSize(maxBytes)}.`
            : "Algunos archivos no se pudieron agregar."
        );
      }
      setFiles((prev) => {
        const seen = new Set(prev.map(fileKey));
        const merged = [...prev];
        for (const f of accepted) {
          if (!seen.has(fileKey(f))) merged.push(f);
        }
        if (merged.length > maxFiles) {
          setError(`Máximo ${maxFiles} archivos.`);
          return merged.slice(0, maxFiles);
        }
        return merged;
      });
    },
    [maxBytes, maxFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize: maxBytes,
    maxFiles,
    disabled: uploading,
  });

  function removeFile(key: string) {
    setFiles((prev) => prev.filter((f) => fileKey(f) !== key));
  }

  /**
   * Arma el FormData con los archivos + itemid (como espera draftfiles_ajax.php)
   * y delega en `onUpload`. Listo para conectar al Route Handler.
   */
  async function handleUpload() {
    if (files.length === 0) {
      setError("Agregá al menos un archivo.");
      return;
    }
    setUploading(true);
    setError("");

    const formData = new FormData();
    if (itemid != null) formData.append("itemid", String(itemid));
    files.forEach((file) => formData.append("files", file, file.name));

    try {
      if (onUpload) {
        await onUpload(formData);
      } else {
        // TODO: conectar con el Route Handler que reenvía a repository/draftfiles_ajax.php
        console.warn("[uploader] FormData listo, falta el Route Handler", {
          itemid,
          count: files.length,
        });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message || "No se pudo subir la entrega.");
    } finally {
      setUploading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-6"
      style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", animation: "fade-in 0.2s ease" }}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Cerrar"
        onClick={() => !uploading && onClose()}
      />

      {/* Panel: bottom-sheet en móvil, tarjeta centrada en PC */}
      <div
        className="relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto bg-[var(--surface)] border border-[var(--separator)] rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 pb-7"
        style={{ animation: "sheet-up 0.28s ease-out" }}
      >
        {/* Grabber móvil */}
        <div className="sm:hidden mx-auto mb-4 h-1.5 w-10 rounded-full bg-[var(--separator)]" />

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[18px] font-bold text-[var(--fg)] tracking-tight">Agregar entrega</h2>
          <button
            type="button"
            onClick={() => !uploading && onClose()}
            className="w-8 h-8 rounded-full bg-[var(--surface2)] flex items-center justify-center active:opacity-70"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4 text-[var(--secondary)]" />
          </button>
        </div>

        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={`rounded-2xl border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors ${
            isDragActive
              ? "border-[#007aff] bg-[var(--accent-light)]"
              : "border-[var(--separator)] bg-[var(--bg)] hover:border-[#007aff]/50"
          }`}
        >
          <input {...getInputProps()} />
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mb-3">
            <UploadCloud className="w-7 h-7 text-[#007aff]" />
          </div>
          <p className="text-[15px] font-semibold text-[var(--fg)]">
            {isDragActive ? "Soltá los archivos acá" : "Arrastrá tus archivos o tocá para elegir"}
          </p>
          <p className="text-[12px] text-[var(--secondary)] mt-1">
            Tamaño máximo: {formatSize(maxBytes)}, máximo {maxFiles} archivos
          </p>
        </div>

        {error && <p className="text-[13px] text-[#ff3b30] text-center mt-3">{error}</p>}

        {/* Cola de archivos */}
        {files.length > 0 && (
          <div className="mt-4 bg-[var(--bg)] rounded-2xl border border-[var(--separator)] overflow-hidden">
            {files.map((file, i) => {
              const key = fileKey(file);
              return (
                <div
                  key={key}
                  className={`flex items-center gap-3 px-3.5 py-2.5 ${
                    i < files.length - 1 ? "border-b border-[var(--separator)]" : ""
                  }`}
                >
                  <div className="w-9 h-9 rounded-[10px] bg-[var(--surface2)] flex items-center justify-center shrink-0">
                    <FileIcon className="w-4 h-4 text-[var(--secondary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-[var(--fg)] truncate">{file.name}</p>
                    <p className="text-[12px] text-[var(--secondary)]">{formatSize(file.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(key)}
                    disabled={uploading}
                    className="w-7 h-7 rounded-full bg-[var(--surface2)] flex items-center justify-center active:opacity-70 disabled:opacity-40 shrink-0"
                    aria-label={`Quitar ${file.name}`}
                  >
                    <X className="w-3.5 h-3.5 text-[var(--secondary)]" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Acciones */}
        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={() => !uploading && onClose()}
            disabled={uploading}
            className="flex-1 py-3 rounded-2xl bg-[var(--surface2)] text-[var(--fg)] font-semibold text-[15px] active:opacity-80 disabled:opacity-50 transition-opacity"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading || files.length === 0}
            className="flex-1 py-3 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <Spinner size={18} color="#ffffff" />
                <span>Guardando…</span>
              </>
            ) : (
              "Guardar cambios"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
