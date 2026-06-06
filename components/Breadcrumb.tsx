"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export interface Crumb {
  label: string;
  /** Si se omite, el segmento es el actual (no navegable). */
  href?: string;
}

/**
 * Migas de pan globales estilo iOS: `‹ Dashboard / Sysacad / Correlatividades`.
 * Cada segmento con `href` es clickeable; el último es la página actual.
 * El chevron lleva al segmento anterior (volver rápido).
 */
export default function Breadcrumb({ items }: { items: Crumb[] }) {
  const parentHref = [...items].reverse().find((c, i) => i > 0 && c.href)?.href;

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
            {c.href && !last ? (
              <Link href={c.href} className="text-[#007aff] font-medium active:opacity-70 truncate">
                {c.label}
              </Link>
            ) : (
              <span
                className={`truncate ${last ? "text-[var(--secondary)] font-medium" : "text-[#007aff] font-medium"}`}
              >
                {c.label}
              </span>
            )}
            {!last && <span className="text-[var(--secondary)]">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
