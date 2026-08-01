"use client";

/** Segmented control estilo iOS: una píldora que se mueve entre opciones. */
export default function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-1 rounded-full bg-[var(--surface2)] p-1"
    >
      {options.map((o) => {
        const activo = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={activo}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
              activo
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-sm"
                : "text-[var(--secondary)] hover:text-[var(--fg)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
