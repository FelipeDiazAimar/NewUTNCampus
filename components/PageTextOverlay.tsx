"use client";

import { useEffect, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";

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
}

export default function PageTextOverlay({ page, scale, pageHeightPx }: Props) {
  const [spans, setSpans] = useState<Span[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSpans(null);
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
          if (!cancelled) setSpans([]);
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
  }, [page, scale]);

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
