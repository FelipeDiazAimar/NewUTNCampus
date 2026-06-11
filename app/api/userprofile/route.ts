import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function getAuth(req: NextRequest) {
  const token = req.cookies.get("moodle_session_token")?.value;
  if (!token) return null;
  return { cookie: `MoodleSession=${token}` };
}

/** Decode &#NNN; numeric HTML entities and common named ones (including &nbsp;). */
function decodeEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Find the <dd> content following a <dt> with the given label.
 * Returns inner HTML stripped of tags, or null if not found.
 */
function extractDt(html: string, label: string): string | null {
  const re = new RegExp(`<dt>${label}<\\/dt>\\s*<dd>([\\s\\S]*?)<\\/dd>`, "i");
  const m = html.match(re);
  if (!m) return null;
  const raw = m[1].replace(/<[^>]+>/g, "");
  return decodeEntities(raw).replace(/\s+/g, " ").trim() || null;
}

/**
 * GET /api/userprofile?userid=N
 * Scrapes /user/profile.php?id=N and returns UserProfile JSON.
 */
export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const userid = req.nextUrl.searchParams.get("userid");
  if (!userid || !/^\d+$/.test(userid)) {
    return NextResponse.json({ error: "userid inválido" }, { status: 400 });
  }

  let html: string;
  try {
    const res = await fetch(
      `https://frsfco.cvg.utn.edu.ar/user/profile.php?id=${userid}`,
      { headers: { Cookie: auth.cookie }, redirect: "follow" }
    );
    if (res.status === 403 || res.status === 404) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 404 });
    }
    html = await res.text();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  // Name from <h1 class="h2 mb-0">…</h1>
  const nameMatch = html.match(/<h1[^>]*class="[^"]*\bh2\b[^"]*"[^>]*>([^<]+)<\/h1>/);
  const name = nameMatch ? nameMatch[1].trim() : "";

  // Email: <dt>Dirección de correo</dt><dd><a href="&#1xx;…to:user@…">…</a></dd>
  let email: string | null = null;
  const emailBlock = html.match(
    /<dt>Direcci[oó]n de correo<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i
  );
  if (emailBlock) {
    const hrefMatch = emailBlock[1].match(/href="([^"]+)"/);
    if (hrefMatch) {
      const decoded = decodeEntities(hrefMatch[1]);           // &#NNN; → chars
      const stripped = decodeURIComponent(decoded);           // %xx → chars
      email = stripped.replace(/^mailto:/i, "").trim() || null;
    }
  }

  // Country / City / Last access
  const country = extractDt(html, "Pa[íi]s");
  const city = extractDt(html, "Ciudad");

  // Last access: strip the trailing relative time "( X días … )"
  let lastAccess: string | null = null;
  const laRaw = extractDt(html, "[ÚU]ltimo acceso al sitio");
  if (laRaw) {
    lastAccess = laRaw.replace(/\([\s\S]*?\)/, "").trim() || laRaw;
  }

  return NextResponse.json({ id: Number(userid), name, email, city, country, lastAccess });
}
