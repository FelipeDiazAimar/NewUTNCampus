import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";

function getUserId(req: NextRequest): string | null {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return null;
  try {
    const data = JSON.parse(decodeURIComponent(raw));
    return data?.userid ? String(data.userid) : null;
  } catch {
    return null;
  }
}

// GET — returns preferences + profile for current user
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json(null, { status: 401 });

  const res = await supabaseFetch(
    `biblioteca_preferencias?moodle_userid=eq.${userId}&select=*&limit=1`
  );

  if (!res.ok) return NextResponse.json(null);
  const rows = await res.json();
  return NextResponse.json(rows[0] ?? null);
}

// POST — upserts preferences + profile
export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json();
  const {
    area_id, tematica_id,
    nombre, apellido, dni, tipo_documento,
    email, telefono, localidad, provincia,
  } = body;

  // Build only defined fields so partial saves (prefs-only or profile-only) work
  const payload: Record<string, unknown> = {
    moodle_userid: userId,
    updated_at: new Date().toISOString(),
  };
  if (area_id !== undefined) payload.area_id = area_id;
  if (tematica_id !== undefined) payload.tematica_id = tematica_id;
  if (nombre !== undefined) payload.nombre = nombre;
  if (apellido !== undefined) payload.apellido = apellido;
  if (dni !== undefined) payload.dni = dni;
  if (tipo_documento !== undefined) payload.tipo_documento = tipo_documento;
  if (email !== undefined) payload.email = email;
  if (telefono !== undefined) payload.telefono = telefono;
  if (localidad !== undefined) payload.localidad = localidad;
  if (provincia !== undefined) payload.provincia = provincia;

  const res = await supabaseFetch(`biblioteca_preferencias`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[biblioteca/preferencias POST]", err);
    return NextResponse.json({ error: "Error guardando" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
