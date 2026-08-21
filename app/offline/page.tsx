export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] px-6">
      <div className="text-center max-w-xs">
        <h1 className="text-[20px] font-semibold text-[var(--fg)] mb-2">Sin conexión</h1>
        <p className="text-[14px] text-[var(--secondary)]">
          Esta página todavía no se guardó para verse sin internet. Conectate y volvé a intentar.
        </p>
      </div>
    </div>
  );
}
