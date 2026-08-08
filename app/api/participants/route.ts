import { NextRequest, NextResponse } from "next/server";
import { MOODLE_BASE, toProxyPath } from "@/lib/moodle";
import { isGuestRequest } from "@/lib/guest";
import { parseParticipants, type Professor } from "@/lib/participants";

export const runtime = "nodejs";

/**
 * GET /api/participants?id=N
 * Scrapes /user/index.php?id=N (Moodle's Participantes page) and returns only
 * professors — used to populate the "Contactar Profesor" modal.
 */
export async function GET(req: NextRequest) {
  if (isGuestRequest(req)) {
    return NextResponse.json({ professors: [] });
  }

  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const courseId = req.nextUrl.searchParams.get("id");
  if (!courseId || !/^\d+$/.test(courseId)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const cookie = `MoodleSession=${sessionToken}`;

  try {
    const res = await fetch(`${MOODLE_BASE}/user/index.php?id=${courseId}&perpage=5000`, {
      headers: { Cookie: cookie },
    });
    if (res.url.includes("/login/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const html = await res.text();
    const professors: Professor[] = parseParticipants(html).map((p) => ({
      ...p,
      avatarUrl: p.avatarUrl ? toProxyPath(p.avatarUrl) : null,
    }));

    return NextResponse.json({ professors });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
