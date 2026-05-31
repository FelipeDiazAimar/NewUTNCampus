"use client";

// iOS Activity Indicator — 12 rounded-cap segments rotating in steps(12).
// Coordinates are pre-computed as static constants so SSR and browser always
// produce identical attribute strings (no floating-point divergence).

interface SpinnerProps {
  size?: number;
  color?: string;
  className?: string;
}

// cx=22, cy=22, r1=9 (inner), r2=16 (outer). Rounded to 4 decimal places.
const SEGMENTS: [number, number, number, number][] = [
  [22,      13,      22,      6      ], // 0°
  [26.5,    14.2058, 30,      8.1436 ], // 30°
  [29.7942, 17.5,    35.8564, 14     ], // 60°
  [31,      22,      38,      22     ], // 90°
  [29.7942, 26.5,    35.8564, 30     ], // 120°
  [26.5,    29.7942, 30,      35.8564], // 150°
  [22,      31,      22,      38     ], // 180°
  [17.5,    29.7942, 14,      35.8564], // 210°
  [14.2058, 26.5,    8.1436,  30     ], // 240°
  [13,      22,      6,       22     ], // 270°
  [14.2058, 17.5,    8.1436,  14     ], // 300°
  [17.5,    14.2058, 14,      8.1436 ], // 330°
];

export default function Spinner({
  size = 24,
  color = "#8e8e93",
  className = "",
}: SpinnerProps) {
  const sw = Math.max(2, size * 0.095);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      className={className}
      aria-label="Cargando"
      role="status"
      style={{
        flexShrink: 0,
        animation: "ios-spin 1s steps(12) infinite",
        transformOrigin: "center",
      }}
    >
      {SEGMENTS.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          opacity={(i + 1) / 12}
        />
      ))}
    </svg>
  );
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export function SpinnerBlock({
  label,
  size = 28,
  color = "#8e8e93",
  minHeight = 96,
}: {
  label?: string;
  size?: number;
  color?: string;
  minHeight?: number;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3" style={{ minHeight }}>
      <Spinner size={size} color={color} />
      {label && (
        <p className="text-[13px] font-medium" style={{ color: "#8e8e93" }}>
          {label}
        </p>
      )}
    </div>
  );
}

export function SpinnerOverlay({ label, visible }: { label?: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
      style={{
        background: "var(--overlay)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        animation: "fade-in 0.15s ease-out",
      }}
    >
      <Spinner size={52} color="var(--fg)" />
      {label && (
        <p className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--fg)" }}>
          {label}
        </p>
      )}
    </div>
  );
}
