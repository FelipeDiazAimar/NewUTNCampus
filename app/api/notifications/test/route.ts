/**
 * POST /api/notifications/test
 *
 * Envía una notificación push de prueba al usuario administrador actual.
 * Requiere cookie admin_session_token + moodle_user para identificar al destinatario.
 * Solo envía a las suscripciones del propio admin — nunca a otros usuarios.
 */

import { NextRequest, NextResponse } from "next/server";
import { sendPushToUser } from "@/lib/webPush";

export const runtime = "nodejs";

const SESSION_TOKEN = "campus-admin-2024-internal";

type EventType =
  | "NUEVA_TAREA"
  | "TAREA_POR_VENCER"
  | "TAREA_VENCIDA"
  | "NUEVO_MENSAJE"
  | "ASISTENCIA_DISPONIBLE";

type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  icon?: string;
  badge?: string;
};

function buildPayload(type: EventType): PushPayload {
  const base = { icon: "/LOGOUTNB.png", badge: "/LOGOUTNB.png" };

  switch (type) {
    case "NUEVA_TAREA":
      return {
        ...base,
        title: "Nueva tarea disponible",
        body: "Análisis de Sistemas — TP N°3: Casos de Uso | Entrega: 20/06/2026",
        url: "/dashboard",
        tag: "nueva-tarea",
      };

    case "TAREA_POR_VENCER":
      return {
        ...base,
        title: "⏰ Tarea por vencer",
        body: "El TP de Análisis de Sistemas vence en 24 horas. ¡No te olvides de entregarlo!",
        url: "/dashboard",
        tag: "tarea-vencimiento",
      };

    case "TAREA_VENCIDA":
      return {
        ...base,
        title: "Tarea vencida",
        body: "El plazo del TP Integrador de Redes venció hace 2 horas. Contactá al docente.",
        url: "/dashboard",
        tag: "tarea-vencida",
      };

    case "NUEVO_MENSAJE":
      return {
        ...base,
        title: "Mensaje de Carlos Rodríguez",
        body: "¿Viste el material nuevo que subió el profe para el parcial?",
        url: "/chat",
        tag: "chat-message",
      };

    case "ASISTENCIA_DISPONIBLE":
      return {
        ...base,
        title: "¡La asistencia está abierta!",
        body: "Entrá al Campus UTN para marcar tu asistencia antes de que cierre.",
        url: "/asistencia",
        tag: "asistencia",
      };

    default:
      return {
        ...base,
        title: "Campus UTN",
        body: "Tenés una novedad.",
        url: "/",
        tag: "campus-notif",
      };
  }
}

function getUserKey(req: NextRequest): string | null {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { username?: string; userid?: number };
    return p.username ?? (p.userid ? String(p.userid) : null);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Verificar sesión admin
  const token = req.cookies.get("admin_session_token")?.value;
  if (token !== SESSION_TOKEN) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Identificar al usuario (para enviar solo a sus dispositivos)
  const userKey = getUserKey(req);
  if (!userKey) {
    return NextResponse.json(
      { error: "No hay sesión de Campus activa. Iniciá sesión en el Campus primero." },
      { status: 403 }
    );
  }

  let body: { type?: EventType };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const type = body.type;
  if (!type) {
    return NextResponse.json({ error: "Falta el campo 'type'" }, { status: 400 });
  }

  const payload = buildPayload(type);

  try {
    const result = await sendPushToUser(userKey, payload);
    if (result.total === 0) {
      return NextResponse.json(
        { error: "No tenés suscripciones push activas. Activá las notificaciones primero." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[notifications/test]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
