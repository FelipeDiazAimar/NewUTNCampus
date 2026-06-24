import { NextRequest, NextResponse } from "next/server";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

async function fetchWithCookie(
  url: string,
  cookie: string,
  extraHeaders: Record<string, string> = {},
  maxRedirects = 5
): Promise<Response> {
  let current = url;
  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetch(current, {
      headers: { Cookie: cookie, ...extraHeaders },
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = loc.startsWith("http") ? loc : `${MOODLE_BASE}${loc}`;
      continue;
    }
    return res;
  }
  throw new Error("Demasiados redirects");
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const fileurl = req.nextUrl.searchParams.get("url");

  if (!sessionToken || !fileurl) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const cookie = `MoodleSession=${sessionToken}`;
  const inline = req.nextUrl.searchParams.get("inline") === "1";

  // Forward Range header so PDF.js can do partial content requests
  const extraHeaders: Record<string, string> = {};
  const range = req.headers.get("range");
  if (range) extraHeaders["Range"] = range;

  const res = await fetchWithCookie(fileurl, cookie, extraHeaders);

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";

  // Moodle returns a 200 HTML login page when the session expires
  if (contentType.startsWith("text/html")) {
    return NextResponse.json(
      { error: "La sesión del Campus expiró. Cerrá sesión y volvé a entrar." },
      { status: 401 }
    );
  }

  const upstreamDisp = res.headers.get("content-disposition") ?? "";
  const disposition = inline ? "inline" : upstreamDisp || "attachment";

  const responseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    "Accept-Ranges": "bytes",
  };

  // Forward range-related headers so PDF.js can paginate
  for (const h of ["content-length", "content-range"] as const) {
    const v = res.headers.get(h);
    if (v) responseHeaders[h === "content-length" ? "Content-Length" : "Content-Range"] = v;
  }

  // Stream the body directly — no full buffering
  return new NextResponse(res.body, {
    status: res.status,
    headers: responseHeaders,
  });
}
