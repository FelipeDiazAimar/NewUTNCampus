import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

type ProfileRow = {
  id: string;
  email: string;
  telegram_chat_id: string | null;
  telegram_link_code: string | null;
  notificaciones_globales_activas: boolean;
};

type MateriaRow = {
  id: string;
  perfil_id: string;
  materia_nombre: string;
  materia_activa: boolean;
  notificar_nuevas: boolean;
  notificar_cierre: boolean;
  notificar_vencimiento: boolean;
  dias_anticipacion_vencimiento: number;
};

function getUserKey(req: NextRequest): string | null {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { username?: string; userid?: number };
    return parsed.username ?? (parsed.userid ? String(parsed.userid) : null);
  } catch {
    return null;
  }
}

async function fetchProfileByEmail(email: string): Promise<ProfileRow | null> {
  const res = await supabaseFetch(
    `perfil_notificaciones?email=eq.${encodeURIComponent(email)}&select=*`
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as ProfileRow[];
  return rows[0] ?? null;
}

async function fetchMaterias(perfilId: string): Promise<MateriaRow[]> {
  const res = await supabaseFetch(
    `notificaciones_materias?perfil_id=eq.${encodeURIComponent(perfilId)}&select=*`
  );
  if (!res.ok) return [];
  return (await res.json()) as MateriaRow[];
}

export async function GET(req: NextRequest) {
  const email = getUserKey(req);
  if (!email) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const profile = await fetchProfileByEmail(email);
  if (!profile) {
    return NextResponse.json({ missing: true }, { status: 404 });
  }

  const materias = await fetchMaterias(profile.id);
  return NextResponse.json({ profile, materias });
}

export async function POST(req: NextRequest) {
  const email = getUserKey(req);
  if (!email) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = (await req.json()) as
    | { action: "init"; courses: string[] }
    | { action: "updateProfile"; profile: Partial<ProfileRow> }
    | { action: "updateMateria"; materia: Partial<MateriaRow> & { materia_nombre: string } };

  if (body.action === "init") {
    let profile = await fetchProfileByEmail(email);
    if (!profile) {
      const insertRes = await supabaseFetch("perfil_notificaciones?select=*", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          email,
          notificaciones_globales_activas: true,
        }),
      });
      if (!insertRes.ok) {
        return NextResponse.json({ error: "No se pudo crear el perfil" }, { status: 500 });
      }
      const rows = (await insertRes.json()) as ProfileRow[];
      profile = rows[0];
    }

    const courses = body.courses ?? [];
    if (courses.length > 0) {
      const rows = courses.map((name) => ({
        perfil_id: profile.id,
        materia_nombre: name,
        materia_activa: true,
        notificar_nuevas: true,
        notificar_cierre: true,
        notificar_vencimiento: true,
        dias_anticipacion_vencimiento: 1,
      }));
      await supabaseFetch(
        "notificaciones_materias?on_conflict=perfil_id,materia_nombre",
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(rows),
        }
      );
    }

    const materias = await fetchMaterias(profile.id);
    return NextResponse.json({ profile, materias });
  }

  if (body.action === "updateProfile") {
    const res = await supabaseFetch(
      `perfil_notificaciones?email=eq.${encodeURIComponent(email)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body.profile),
      }
    );
    if (!res.ok) {
      return NextResponse.json({ error: "No se pudo actualizar el perfil" }, { status: 500 });
    }
    const rows = (await res.json()) as ProfileRow[];
    return NextResponse.json({ profile: rows[0] ?? null });
  }

  if (body.action === "updateMateria") {
    const profile = await fetchProfileByEmail(email);
    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 404 });
    }

    const updatePayload = { ...body.materia } as Record<string, unknown>;
    delete updatePayload.materia_nombre;

    const res = await supabaseFetch(
      `notificaciones_materias?perfil_id=eq.${encodeURIComponent(profile.id)}&materia_nombre=eq.${encodeURIComponent(body.materia.materia_nombre)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(updatePayload),
      }
    );
    if (!res.ok) {
      return NextResponse.json({ error: "No se pudo actualizar la materia" }, { status: 500 });
    }
    const rows = (await res.json()) as MateriaRow[];
    return NextResponse.json({ materia: rows[0] ?? null });
  }

  return NextResponse.json({ error: "Accion no soportada" }, { status: 400 });
}
