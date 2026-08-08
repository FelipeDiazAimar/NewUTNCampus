"use client";

import { useEffect, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { recognizePage } from "@/lib/ocrWorker";
import { getCachedPage, setCachedPage } from "@/lib/ocrCache";

interface Span {
  text: string;
  left: number;     // percent of page width
  top: number;      // percent of page height
  fontSize: number;  // fraction (0-1) of page height
}

interface Props {
  page: PDFPageProxy | null;
  scale: number;
  pageHeightPx: number;
  cacheKey: string;
  canvasEl: HTMLCanvasElement | null;
}

export default function PageTextOverlay({ page, scale, pageHeightPx, cacheKey, canvasEl }: Props) {
  const [spans, setSpans] = useState<Span[] | null>(null);
  const [ocrPending, setOcrPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSpans(null);
    setOcrPending(false);
    if (!page) return;

    (async () => {
      try {
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
        const totalChars = textContent.items.reduce(
          (n, item) => n + ("str" in item ? item.str.length : 0),
          0,
        );
        if (totalChars < 3) {
          if (!canvasEl) { if (!cancelled) setSpans([]); return; }
          try {
            const cached = await getCachedPage(cacheKey);
            let words = cached;
            if (!words) {
              setOcrPending(true);
              try {
                words = await recognizePage(canvasEl);
              } finally {
                if (!cancelled) setOcrPending(false);
              }
              await setCachedPage(cacheKey, words);
            }
            const built: Span[] = words
              .filter((w) => w.text.trim())
              .map((w) => ({
                text: w.text,
                left: w.x * 100,
                top: w.y * 100,
                fontSize: w.height,
              }));
            if (!cancelled) setSpans(built);
          } catch {
            if (!cancelled) setSpans([]);
          }
          return;
        }
        const built: Span[] = [];
        for (const item of textContent.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const tx = item.transform;
          const fontHeight = Math.hypot(tx[2], tx[3]);
          const x = tx[4];
          const y = tx[5];
          built.push({
            text: item.str,
            left: (x / viewport.width) * 100,
            top: ((viewport.height - y - fontHeight) / viewport.height) * 100,
            fontSize: fontHeight / viewport.height,
          });
        }
        if (!cancelled) setSpans(built);
      } catch {
        if (!cancelled) setSpans([]);
      }
    })();

    return () => { cancelled = true; };
  }, [page, scale, cacheKey, canvasEl]);

  if (ocrPending) {
    return (
      <div className="absolute top-2 right-2" style={{ pointerEvents: "none" }} title="Reconociendo texto…">
        <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!spans || spans.length === 0) return null;

  return (
    <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
      {spans.map((s, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${s.left}%`,
            top: `${s.top}%`,
            fontSize: `${s.fontSize * pageHeightPx}px`,
            color: "transparent",
            whiteSpace: "pre",
            lineHeight: 1,
            pointerEvents: "auto",
            userSelect: "text",
          }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
}
