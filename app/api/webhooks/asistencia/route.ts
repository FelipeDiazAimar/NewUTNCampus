import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";
import { sendPushNotification } from "@/lib/webPush";
import { hasWorkerSecret } from "@/lib/workerAuth";

export const runtime = "nodejs";

type Opcion = { id: string; name: string };
type AsistenciaWebhookPayload = {
  materia?: string;
  source?: string;
  activeOptions?: Opcion[];
};

/** "ANÁLISIS MATEMÁTICO I - 2026 - ISI - 2008 - A" -> "ANÁLISIS MATEMÁTICO I" */
function limpiarNombreMateria(nombre: string): string {
  return nombre.replace(/\s*[-–]\s*\d{4}\b.*$/u, "").trim() || nombre.trim();
}

/** Fecha de hoy en Argentina, formato YYYY-MM-DD. */
function hoyArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** true si NO había fila para (fecha, materiaId) y la insertó ahora. */
async function reservarAviso(
  fecha: string,
  materiaId: string,
  materiaNombre: string
): Promise<boolean> {
  const yaRes = await supabaseFetch(
    `asistencia_avisos_log?select=materia_id&fecha=eq.${fecha}&materia_id=eq.${encodeURIComponent(materiaId)}`
  );
  if (yaRes.ok) {
    const filas = (await yaRes.json()) as unknown[];
    if (filas.length > 0) return false;
  }
  const insRes = await supabaseFetch("asistencia_avisos_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      fecha,
      materia_id: materiaId,
      materia_nombre: materiaNombre,
      enviados: 0,
    }),
  });
  // 201 = insertada; 409 = otro daemon la insertó en la carrera -> ya avisado.
  return insRes.ok;
}

export async function POST(req: NextRequest) {
  // Fail-closed: si NOTIFICATIONS_WEBHOOK_SECRET no está seteado, se rechaza todo.
  if (!hasWorkerSecret(req, ["x-agent-secret", "x-notify-secret"])) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => ({}))) as AsistenciaWebhookPayload;

  // Normalizar: aceptar el shape viejo { materia } suelto.
  let opciones: Opcion[] = Array.isArray(payload.activeOptions)
    ? payload.activeOptions.filter((o) => o && o.id && o.name)
    : [];
  if (opciones.length === 0 && payload.materia) {
    opciones = [{ id: payload.materia, name: payload.materia }];
  }
  if (opciones.length === 0) {
    return NextResponse.json({ ok: true, materias: [] });
  }

  // Usuarios que desactivaron los avisos de asistencia (o el global) — se excluyen.
  const disabledRes = await supabaseFetch(
    "perfil_notificaciones?or=(notificaciones_globales_activas.eq.false,notificar_asistencia.eq.false)&select=email"
  );
  const excludeUserKeys = disabledRes.ok
    ? new Set(((await disabledRes.json()) as { email: string }[]).map((r) => r.email))
    : undefined;

  const fecha = hoyArgentina();
  const materias: { materiaId: string; materia: string; enviado: boolean; sent?: number }[] = [];

  for (const opcion of opciones) {
    const nombre = limpiarNombreMateria(opcion.name);
    const nuevo = await reservarAviso(fecha, opcion.id, nombre);
    if (!nuevo) {
      materias.push({ materiaId: opcion.id, materia: nombre, enviado: false });
      continue;
    }

    const result = await sendPushNotification(
      {
        title: "¡La asistencia está abierta!",
        body: `Ya podés marcar asistencia en ${nombre}.`,
        url: "/asistencia",
        tag: `asistencia-${opcion.id}`,
      },
      excludeUserKeys
    );

    await supabaseFetch(
      `asistencia_avisos_log?fecha=eq.${fecha}&materia_id=eq.${encodeURIComponent(opcion.id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ enviados: result.sent }),
      }
    ).catch(() => {});

    materias.push({ materiaId: opcion.id, materia: nombre, enviado: true, sent: result.sent });
  }

  return NextResponse.json({ ok: true, materias });
}
