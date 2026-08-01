"use client";

function Punto({ on }: { on: boolean }) {
  return on ? (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34c759]" />
  ) : (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-[var(--secondary)]" />
  );
}

/**
 * Estado de la materia en los dos sistemas que tienen que coincidir.
 * Inscribirse en Sysacad no matricula en el campus, así que de un vistazo
 * muestra qué falta: "Sysacad ● · Campus ○".
 */
export default function EstadoSincronizacion({
  sysacad,
  campus,
}: {
  sysacad: boolean;
  campus: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-medium text-[var(--secondary)]">
      <span className="inline-flex items-center gap-1">
        <Punto on={sysacad} />
        Sysacad
      </span>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        <Punto on={campus} />
        Campus
      </span>
    </span>
  );
}
