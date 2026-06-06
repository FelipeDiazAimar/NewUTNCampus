import { NextRequest, NextResponse } from "next/server";
import {
  type SysacadAuth,
  type SysacadRecurso,
  sysacadFetch,
  resolveRecursoPath,
  parseEstadoAcademico,
  parseCorrelatividades,
  parseMaterias,
  parseNotas,
  parseTitulo,
} from "@/lib/sysacad";

const RECURSOS: SysacadRecurso[] = ["estado", "correlatividades", "materias", "notas"];

/** Lee la sesión Sysacad (cookie httpOnly con { cookie, baseUrl }). */
function getAuth(req: NextRequest): SysacadAuth | null {
  const raw = req.cookies.get("sysacad_session")?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SysacadAuth;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recurso: string }> }
) {
  const { recurso } = await params;
  if (!RECURSOS.includes(recurso as SysacadRecurso)) {
    return NextResponse.json({ error: "Recurso desconocido" }, { status: 404 });
  }

  const auth = getAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "No autenticado en Sysacad" }, { status: 401 });
  }

  try {
    const path = await resolveRecursoPath(auth, recurso as SysacadRecurso);
    const html = await sysacadFetch(auth, path);
    const { titulo, alumno } = parseTitulo(html);

    let data: unknown;
    switch (recurso as SysacadRecurso) {
      case "estado":
        data = parseEstadoAcademico(html);
        break;
      case "correlatividades":
        data = parseCorrelatividades(html);
        break;
      case "materias":
        data = parseMaterias(html);
        break;
      case "notas":
        data = parseNotas(html, auth.baseUrl);
        break;
    }

    return NextResponse.json({ titulo, alumno, data });
  } catch (err) {
    const message = (err as Error).message;
    // sysacadFetch lanza este texto cuando la sesión murió (302).
    const expired = message.includes("expiró");
    console.error(`[sysacad-api] ${recurso} error:`, message);
    return NextResponse.json({ error: message }, { status: expired ? 401 : 500 });
  }
}
