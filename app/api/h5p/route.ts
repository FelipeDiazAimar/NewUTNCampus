import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
}

/**
 * Resolves an H5P activity (mod_h5pactivity) to the embeddable player URL,
 * routed through /api/cvg so it loads authenticated and same-origin. This lets
 * the course page show the H5P inline instead of linking out to Moodle.
 */
export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const id = req.nextUrl.searchParams.get("id");

  if (!sessionToken || !id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const cookie = `MoodleSession=${sessionToken}`;

  try {
    const res = await fetch(`${MOODLE_BASE}/mod/h5pactivity/view.php?id=${id}`, {
      headers: { Cookie: cookie },
    });
    if (res.url.includes("/login/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const html = await res.text();

    const title = decodeEntities(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]?.trim() ?? "").trim();

    // The player lives in an <iframe ... src="…/h5p/embed.php?…">.
    const rawSrc =
      html.match(/<iframe[^>]+src="([^"]*\/h5p\/embed\.php[^"]*)"/i)?.[1] ??
      html.match(/<iframe[^>]+src="([^"]+)"[^>]*class="[^"]*h5p-player[^"]*"/i)?.[1];

    if (!rawSrc) {
      return NextResponse.json({ error: "Esta actividad H5P no tiene contenido visible." }, { status: 404 });
    }

    // Decode HTML entities then route the absolute frsfco URL through our proxy.
    const embedUrl = decodeEntities(rawSrc).replace(`${MOODLE_BASE}/`, "/api/cvg/");

    return NextResponse.json({ data: { embedUrl, title } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
