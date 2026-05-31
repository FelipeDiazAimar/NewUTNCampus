import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

type EventPayload = {
  course: string;
  type: "new" | "closed" | "due";
  dueAt?: string;
  title?: string;
};

type MateriaWithProfile = {
  materia_nombre: string;
  materia_activa: boolean;
  notificar_nuevas: boolean;
  notificar_cierre: boolean;
  notificar_vencimiento: boolean;
  dias_anticipacion_vencimiento: number;
  perfil: {
    telegram_chat_id: string | null;
    notificaciones_globales_activas: boolean;
  };
};

async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFICATIONS_WEBHOOK_SECRET ?? "";
  const provided = req.headers.get("x-notify-secret") ?? "";
  if (secret && secret !== provided) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = (await req.json()) as EventPayload;
  if (!payload.course || !payload.type) {
    return NextResponse.json({ error: "Payload incompleto" }, { status: 400 });
  }

  const res = await supabaseFetch(
    `notificaciones_materias?materia_nombre=eq.${encodeURIComponent(payload.course)}&select=*,perfil:perfil_notificaciones(telegram_chat_id,notificaciones_globales_activas)`
  );
  if (!res.ok) {
    return NextResponse.json({ error: "No se pudo consultar Supabase" }, { status: 500 });
  }

  const rows = (await res.json()) as MateriaWithProfile[];
  const now = Date.now();

  const targets = rows.filter((row) => {
    if (!row.materia_activa) return false;
    if (!row.perfil?.notificaciones_globales_activas) return false;
    if (!row.perfil?.telegram_chat_id) return false;

    if (payload.type === "new") return row.notificar_nuevas;
    if (payload.type === "closed") return row.notificar_cierre;

    if (payload.type === "due") {
      if (!row.notificar_vencimiento || !payload.dueAt) return false;
      const dueTime = new Date(payload.dueAt).getTime();
      if (Number.isNaN(dueTime)) return false;
      const daysLeft = Math.ceil((dueTime - now) / 86400000);
      return daysLeft <= row.dias_anticipacion_vencimiento;
    }

    return false;
  });

  const message =
    payload.type === "new"
      ? `Nueva tarea en ${payload.course}: ${payload.title ?? "Nueva actividad"}`
      : payload.type === "closed"
        ? `Cierre de tarea en ${payload.course}: ${payload.title ?? "Actividad"}`
        : `Tarea por vencer en ${payload.course}: ${payload.title ?? "Actividad"}`;

  await Promise.all(
    targets.map((row) => sendTelegramMessage(row.perfil.telegram_chat_id!, message))
  );

  return NextResponse.json({ ok: true, sent: targets.length });
}
