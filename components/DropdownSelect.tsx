"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Loader2 } from "lucide-react";

export type DropdownOption = { value: string; label: string };

type Props = {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
};

export default function DropdownSelect({
  value,
  options,
  onChange,
  placeholder = "Seleccionar...",
  loading = false,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const isDisabled = disabled || loading || options.length === 0;

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => !isDisabled && setOpen((o) => !o)}
        disabled={isDisabled}
        className={[
          "w-full flex items-center justify-between gap-2",
          "rounded-xl border bg-[var(--surface2)] px-3.5 py-2.5",
          "text-[14px] text-left outline-none transition-all duration-150",
          open
            ? "border-[#007aff] ring-2 ring-[#007aff]/20"
            : "border-[var(--separator)]",
          isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-[#007aff]/50",
        ].join(" ")}
      >
        <span className={selected ? "text-[var(--fg)]" : "text-[var(--secondary)]"}>
          {loading
            ? "Cargando..."
            : selected
            ? selected.label
            : placeholder}
        </span>
        <span className="flex-shrink-0 text-[var(--secondary)]">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ChevronDown
              className="w-4 h-4 transition-transform duration-200"
              style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          )}
        </span>
      </button>

      {/* Dropdown list */}
      {open && options.length > 0 && (
        <div
          className={[
            "absolute left-0 right-0 z-50 mt-1.5",
            "rounded-2xl border border-[var(--navbar-border)]",
            "bg-[var(--surface)] backdrop-blur-xl shadow-lg",
            "overflow-hidden",
            "animate-in fade-in slide-in-from-top-1 duration-150",
          ].join(" ")}
          style={{ maxHeight: "260px", overflowY: "auto" }}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={[
                  "w-full flex items-center justify-between gap-3",
                  "px-4 py-3 text-[14px] text-left transition-colors duration-100",
                  "active:bg-[#007aff]/10",
                  isSelected
                    ? "bg-[#007aff]/8 text-[#007aff] font-medium"
                    : "text-[var(--fg)] hover:bg-[var(--surface2)]",
                  idx < options.length - 1 ? "border-b border-[var(--separator)]/60" : "",
                ].join(" ")}
              >
                <span className="leading-snug">{opt.label}</span>
                {isSelected && <Check className="w-4 h-4 flex-shrink-0 text-[#007aff]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
