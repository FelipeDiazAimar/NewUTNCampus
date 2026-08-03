import { NextRequest, NextResponse } from "next/server";
import { fetchOfficialSchedule } from "@/lib/officialSchedule";

export const runtime = "nodejs";

/** especialidad (Sysacad) desde la cookie legible — misma que setea el login. */
function getEspecialidad(req: NextRequest): string | null {
  const raw = req.cookies.get("sysacadws_user")?.value;
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { especialidad?: string }).especialidad ?? null;
  } catch {
    return null;
  }
}

// Grilla oficial de horarios de la carrera (sanfrancisco.utn.edu.ar), usada para
// completar/corroborar el aula de cada materia. Es información pública de la
// facultad (no depende de la sesión de Sysacad del alumno más que para saber
// qué carrera mirar), así que también sirve en modo invitado.
export async function GET(req: NextRequest) {
  const especialidad = getEspecialidad(req);
  if (!especialidad) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const slots = await fetchOfficialSchedule(especialidad);
  return NextResponse.json({ carrera: especialidad, slots });
}
