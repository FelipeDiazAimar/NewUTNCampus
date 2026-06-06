"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export interface Crumb {
  label: string;
  /** Si se omite, el segmento es la página actual (no navegable). */
  href?: string;
}

/**
 * Migas de pan globales estilo iOS: `‹ Dashboard / Sysacad / Correlatividades`.
 * TODO segmento con `href` es clickeable (tanto el nombre como el chevron);
 * solo los segmentos SIN `href` se muestran como página actual (en gris).
 * El chevron lleva al último segmento navegable (volver rápido).
 */
export default function Breadcrumb({ items }: { items: Crumb[] }) {
  // Parent = último segmento navegable (el más cercano hacia atrás).
  const parentHref = [...items].reverse().find((c) => c.href)?.href;

  return (
    <nav className="flex items-center gap-1.5 mb-4 text-[15px] flex-wrap">
      {parentHref ? (
        <Link href={parentHref} className="text-[#007aff] shrink-0 active:opacity-70" aria-label="Volver">
          <ChevronLeft className="w-4 h-4" />
        </Link>
      ) : (
        <ChevronLeft className="w-4 h-4 text-[var(--secondary)] shrink-0" />
      )}

      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1.5 min-w-0">
            {c.href ? (
              <Link href={c.href} className="text-[#007aff] font-medium active:opacity-70 truncate">
                {c.label}
              </Link>
            ) : (
              <span className="text-[var(--secondary)] font-medium truncate">{c.label}</span>
            )}
            {!last && <span className="text-[var(--secondary)]">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
