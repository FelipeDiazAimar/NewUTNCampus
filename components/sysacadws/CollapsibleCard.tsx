"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

/** Tarjeta glass colapsable (iOS) reutilizada por los widgets de Sysacad. */
export default function CollapsibleCard({
  title,
  icon: Icon,
  iconColor,
  right,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: LucideIcon;
  iconColor: string;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] backdrop-blur-md shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-5 py-4 text-left active:bg-[var(--surface2)]">
        <Icon className="w-[18px] h-[18px] shrink-0" style={{ color: iconColor }} />
        <span className="flex-1 text-[15px] font-semibold text-[var(--fg)]">{title}</span>
        {right}
        <ChevronDown className={`w-4 h-4 text-[var(--secondary)] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}
