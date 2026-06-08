import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";
const MOODLE_HOST = "frsfco.cvg.utn.edu.ar";

/**
 * Authenticated reverse-proxy for the Moodle host. Any request under
 * /api/cvg/<path> is forwarded to https://frsfco.cvg.utn.edu.ar/<path> with the
 * user's MoodleSession cookie attached. Text responses (HTML/JS/CSS/JSON) have
 * their absolute frsfco URLs rewritten back through this proxy so that nested
 * resources (the H5P player, its libraries and pluginfile content) keep loading
 * same-origin and authenticated instead of hitting Moodle anonymously.
 *
 * This is what lets an H5P activity render *inside* the app rather than
 * redirecting the user to the faculty site.
 */
function rewriteBody(text: string): string {
  return text
    // Plain absolute URLs in HTML/CSS/attributes.
    .split(`${MOODLE_BASE}/`).join("/api/cvg/")
    .split(`https://${MOODLE_HOST}`).join("/api/cvg")
    // Escaped-slash form found inside JSON / JS string literals (H5PIntegration).
    .split(`https:\\/\\/${MOODLE_HOST}\\/`).join("\\/api\\/cvg\\/")
    .split(`https:\\/\\/${MOODLE_HOST}`).join("\\/api\\/cvg")
    // Protocol-relative form.
    .split(`//${MOODLE_HOST}/`).join("/api/cvg/");
}

const TEXT_CT = /text\/html|javascript|ecmascript|application\/json|text\/css|text\/plain/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { path } = await params;
  if (!path?.length) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 });
  }

  const target = `${MOODLE_BASE}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const cookie = `MoodleSession=${sessionToken}`;

  try {
    const res = await fetch(target, { headers: { Cookie: cookie }, cache: "no-store" });
    const ct = res.headers.get("content-type") ?? "application/octet-stream";

    const headers: Record<string, string> = { "content-type": ct };
    // Allow this content to be framed by our own app.
    headers["content-security-policy"] = "frame-ancestors 'self'";

    if (TEXT_CT.test(ct)) {
      const text = rewriteBody(await res.text());
      return new NextResponse(text, { status: res.status, headers });
    }

    const buf = await res.arrayBuffer();
    return new NextResponse(buf, { status: res.status, headers });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
