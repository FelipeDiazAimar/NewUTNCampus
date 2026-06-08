"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Spinner from "@/components/Spinner";
import type { MoodleModule } from "@/lib/moodle";

function idFromUrl(url?: string): string | null {
  if (!url) return null;
  return url.match(/[?&]id=(\d+)/)?.[1] ?? null;
}

// ─── H5pViewer — folder-style row that expands the H5P player inline ──────────
export default function H5pViewer({ mod }: { mod: MoodleModule }) {
  const [open, setOpen] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const id = idFromUrl(mod.url);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && !embedUrl && !loading && id) {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/h5p?id=${id}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "No se pudo abrir la actividad");
        setEmbedUrl(j.data.embedUrl as string);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
  }, [open, embedUrl, loading, id]);

  // H5P auto-resize protocol: the embedded player posts {context:'h5p', …}
  // messages; we answer its handshake and size the iframe to its content.
  useEffect(() => {
    if (!embedUrl) return;
    function onMessage(event: MessageEvent) {
      const data = event.data as { context?: string; action?: string; scrollHeight?: number };
      if (data?.context !== "h5p") return;
      const frame = iframeRef.current;
      if (!frame) return;
      if (data.action === "hello" || data.action === "prepareResize") {
        frame.contentWindow?.postMessage({ context: "h5p", action: "hello" }, "*");
      } else if (data.action === "resize" && data.scrollHeight) {
        frame.style.height = `${Math.max(data.scrollHeight, 320)}px`;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedUrl]);

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] active:bg-[var(--surface2)] transition-colors text-left"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-bold"
          style={{ background: "#f3e8ff", color: "#af52de", fontSize: "9px" }}
        >
          H5P
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] text-[var(--fg)] truncate">{mod.name}</p>
        </div>
        <svg
          className={`w-4 h-4 text-[var(--secondary)] shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        >
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[rgba(60,60,67,0.08)] bg-[var(--surface2)]">
          {loading && (
            <div className="flex items-center justify-center gap-2.5 h-16">
              <Spinner size={18} color="#af52de" />
              <span className="text-[13px] text-[var(--secondary)]">Cargando actividad…</span>
            </div>
          )}

          {error && (
            <div className="px-4 py-4 text-center">
              <p className="text-[13px] text-[#ff3b30] mb-3">{error}</p>
              {id && (
                <a
                  href={`/api/cvg/mod/h5pactivity/view.php?id=${id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-[var(--surface)] border border-[var(--separator)] text-[13px] font-semibold text-[var(--accent)]"
                >
                  Abrir en pantalla completa
                </a>
              )}
            </div>
          )}

          {embedUrl && !loading && (
            <div className="p-3">
              <iframe
                ref={iframeRef}
                src={embedUrl}
                title={mod.name}
                allowFullScreen
                allow="autoplay; fullscreen; geolocation; microphone; camera; midi; encrypted-media"
                className="w-full rounded-xl border border-[var(--separator)] bg-white"
                style={{ height: "70vh" }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
