"use client";

import { useState } from "react";
import { Bell, Loader2, CheckCircle2, XCircle } from "lucide-react";

type Estado = "idle" | "loading" | "ok" | "error";
type Resultado = { total: number; sent: number; failed: number; error?: string } | null;

export default function PushTestSection() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<Estado>("idle");
  const [res, setRes] = useState<Resultado>(null);

  async function enviar(target: "email" | "all") {
    if (
      target === "all" &&
      !window.confirm("Mandar una push de prueba a TODOS los dispositivos registrados?")
    ) {
      return;
    }
    setEstado("loading");
    setRes(null);
    try {
      const r = await fetch("/api/admin/notifications/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target === "email" ? { target, email } : { target }),
      });
      const j = await r.json().catch(() => ({}));
      setRes(j);
      setEstado(r.ok && (j.failed ?? 0) === 0 ? "ok" : "error");
    } catch {
      setEstado("error");
      setRes({ total: 0, sent: 0, failed: 0, error: "No se pudo llamar al endpoint" });
    } finally {
      setTimeout(() => setEstado("idle"), 4000);
    }
  }

  const Icono =
    estado === "loading" ? Loader2 : estado === "ok" ? CheckCircle2 : estado === "error" ? XCircle : Bell;

  return (
    <section className="mb-7">
      <p className="px-4 mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--secondary)]">
        Notificaciones push — prueba
      </p>

      <div className="overflow-hidden rounded-[20px] border border-[var(--separator)] bg-[var(--surface)] shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--separator)]">
          <Icono
            className={`h-[18px] w-[18px] ${estado === "loading" ? "animate-spin" : ""}`}
            style={{
              color: estado === "ok" ? "#34c759" : estado === "error" ? "#ff3b30" : "var(--secondary)",
            }}
          />
          <span className="text-[14px] text-[var(--secondary)]">
            Manda una push real a los dispositivos elegidos.
          </span>
        </div>

        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
          <input
            type="email"
            inputMode="email"
            placeholder="email del usuario"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-[12px] border border-[var(--separator)] bg-transparent px-3 py-2 text-[15px] text-[var(--fg)] outline-none focus:border-[#007aff]"
          />
          <button
            type="button"
            disabled={estado === "loading" || !email.trim()}
            onClick={() => enviar("email")}
            className="rounded-[12px] px-3 py-2 text-[14px] font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: "#007aff" }}
          >
            Enviar a este usuario
          </button>
        </div>

        <div className="px-4 pb-3">
          <button
            type="button"
            disabled={estado === "loading"}
            onClick={() => enviar("all")}
            className="rounded-[12px] border px-3 py-2 text-[14px] font-medium disabled:opacity-40"
            style={{ borderColor: "#ff3b30", color: "#ff3b30" }}
          >
            Enviar a todos
          </button>
        </div>

        {res && (
          <div className="border-t border-[var(--separator)] px-4 py-3 text-[13px]">
            {res.error ? (
              <p style={{ color: "#ff3b30" }}>{res.error}</p>
            ) : (
              <p className="text-[var(--secondary)]">
                Total <b className="text-[var(--fg)]">{res.total}</b> · OK{" "}
                <b style={{ color: "#34c759" }}>{res.sent}</b> · fallidas{" "}
                <b style={{ color: "#ff3b30" }}>{res.failed}</b>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
