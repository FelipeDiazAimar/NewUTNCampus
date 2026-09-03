// El daemon de asistencia pide acá las credenciales de los usuarios con el
// aviso activo. El server descifra (SESSION_SECRET nunca sale del server) y
// devuelve base64("legajo:dni") listo para lib/asistenciaLegacy.ts:login().
// Gated por x-worker-secret = NOTIFICATIONS_WEBHOOK_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { decryptCred } from "@/lib/crypto";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIAS_VIGENCIA = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.NOTIFICATIONS_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-worker-secret") !== secret) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const desde = new Date(Date.now() - DIAS_VIGENCIA * 86400000).toISOString();
  let rows: Array<{
    legajo: string;
    cred_cifrada: string;
    comisiones: unknown[] | null;
    comisiones_at: string | null;
  }> = [];
  try {
    const res = await supabaseFetch(
      `asistencia_credenciales?select=legajo,cred_cifrada,comisiones,comisiones_at&visto_at=gte.${desde}`
    );
    if (res.ok) rows = await res.json();
  } catch {
    /* devolvemos lista vacía */
  }

  const credenciales = rows
    .map((r) => {
      const auth = decryptCred(r.cred_cifrada);
      if (!auth) return null;
      return { legajo: r.legajo, auth, comisiones: r.comisiones, comisiones_at: r.comisiones_at };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ credenciales });
}
