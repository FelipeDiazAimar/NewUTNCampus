/**
 * POST /api/asistencia/notify
 * Dispara manualmente la notificación push "asistencia disponible".
 * Solo accesible con cookie admin_session_token.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/webPush";

export const runtime = "nodejs";

const ADMIN_TOKEN = "campus-admin-2024-internal";

export async function POST(req: NextRequest) {
  if (req.cookies.get("admin_session_token")?.value !== ADMIN_TOKEN) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let materia: string | undefined;
  try {
    const body = await req.json();
    materia = body.materia;
  } catch { /* sin body — ok */ }

  // Actualizar el estado del agente para reflejar el disparo manual.
  await supabaseFetch("asistencia_agent_status?agent_id=eq.motorola-local", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status: "detected",
      last_seen_at: new Date().toISOString(),
      last_payload: { source: "admin-manual", materia: materia ?? null },
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => {});

  // Usuarios que desactivaron los avisos de asistencia (o el global) — se excluyen.
  const disabledRes = await supabaseFetch(
    "perfil_notificaciones?or=(notificaciones_globales_activas.eq.false,notificar_asistencia.eq.false)&select=email"
  );
  const excludeUserKeys = disabledRes.ok
    ? new Set(((await disabledRes.json()) as { email: string }[]).map((r) => r.email))
    : undefined;

  const result = await sendPushNotification(
    {
      title: "¡La asistencia está abierta!",
      body: materia
        ? `Ya podés marcar asistencia en ${materia}.`
        : "Ya podés marcar tu asistencia.",
      url: "/asistencia",
      tag: "asistencia-abierta",
    },
    excludeUserKeys
  );

  return NextResponse.json({ ok: true, ...result });
}
