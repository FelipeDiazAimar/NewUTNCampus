// Guarda / borra la credencial de Sysacad cifrada del usuario actual, según su
// preferencia "Avisar asistencia disponible". La usa el daemon de asistencia
// para loguearse al legacy como el usuario y ver sus comisiones.
//
// Se llama fire-and-forget desde SessionGuard (keepalive) y desde
// /notificaciones al togglear. NUNCA rompe el flujo que la invoca: cualquier
// error responde 200.

import { NextRequest, NextResponse } from "next/server";
import { encryptCred } from "@/lib/crypto";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function emailFromCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { username?: string; userid?: number };
    return p.username ?? (p.userid ? String(p.userid) : null);
  } catch {
    return null;
  }
}

function legajoFromAuth(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const dec = Buffer.from(raw, "base64").toString("utf8");
    const legajo = dec.split(":")[0]?.trim();
    return legajo || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.cookies.get("sysacadws_auth")?.value;
    const legajo = legajoFromAuth(auth);
    const email = emailFromCookie(req.cookies.get("moodle_user")?.value);
    if (!auth || !legajo) {
      return NextResponse.json({ ok: false }, { status: 200 }); // sin sesión de Sysacad
    }

    // ¿El usuario quiere el aviso de asistencia?
    let quiere = false;
    if (email) {
      const res = await supabaseFetch(
        `perfil_notificaciones?email=eq.${encodeURIComponent(email)}&select=notificar_asistencia,notificaciones_globales_activas`
      );
      if (res.ok) {
        const rows = (await res.json()) as {
          notificar_asistencia: boolean;
          notificaciones_globales_activas: boolean;
        }[];
        const p = rows[0];
        quiere = !!p && p.notificar_asistencia && p.notificaciones_globales_activas;
      }
    }

    if (!quiere) {
      await supabaseFetch(`asistencia_credenciales?legajo=eq.${encodeURIComponent(legajo)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      }).catch(() => {});
      return NextResponse.json({ ok: true, stored: false }, { status: 200 });
    }

    await supabaseFetch("asistencia_credenciales?on_conflict=legajo", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        legajo,
        cred_cifrada: encryptCred(auth),
        email,
        visto_at: new Date().toISOString(),
      }),
    });
    return NextResponse.json({ ok: true, stored: true }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
