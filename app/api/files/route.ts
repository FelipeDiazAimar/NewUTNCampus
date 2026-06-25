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

  // Moodle sometimes returns HTML from view.php instead of redirecting directly.
  // Try to extract the real file URL before giving up.
  if (contentType.startsWith("text/html")) {
    const html = await res.text();

    // Genuine session expiry: Moodle login page has a logintoken field
    if (html.includes("logintoken") || html.includes("/login/index.php")) {
      return NextResponse.json(
        { error: "La sesión del Campus expiró. Cerrá sesión y volvé a entrar." },
        { status: 401 }
      );
    }

    // Extract actual file URL from common Moodle HTML patterns.
    // Use specific patterns to avoid matching navbar/avatar pluginfile.php URLs.

    // 1. <meta http-equiv="refresh" content="0; url=...">
    const metaUrl =
      html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"'\s>]+)/i)?.[1] ??
      html.match(/content=["'][^"']*url=([^"'\s>]+)["'][^>]*http-equiv=["']refresh["']/i)?.[1];

    // 2. href with Moodle resource content path (most specific — avoids images/avatars)
    const hrefUrl =
      html.match(/href=["']([^"']*pluginfile\.php\/\d+\/mod_resource\/content\/\d+\/[^"']+)/i)?.[1];

    // 3. JS redirect (window.location / document.location)
    const jsUrl =
      html.match(/(?:window|document)\.location(?:\.href)?\s*=\s*["']([^"']*pluginfile\.php[^"']*)/i)?.[1];

    const found = metaUrl ?? hrefUrl ?? jsUrl;

    if (found) {
      const absolute = found.startsWith("//") ? `https:${found}`
        : found.startsWith("/")               ? `${MOODLE_BASE}${found}`
        : found;
      const fileRes = await fetchWithCookie(absolute, cookie, extraHeaders);
      const fileCT = fileRes.headers.get("content-type") ?? "application/octet-stream";
      if (!fileCT.startsWith("text/html")) {
        const upstreamDisp2 = fileRes.headers.get("content-disposition") ?? "";
        const disposition2  = inline ? "inline" : upstreamDisp2 || "attachment";
        const h2: Record<string, string> = {
          "Content-Type": fileCT,
          "Content-Disposition": disposition2,
          "Accept-Ranges": "bytes",
        };
        for (const h of ["content-length", "content-range"] as const) {
          const v = fileRes.headers.get(h);
          if (v) h2[h === "content-length" ? "Content-Length" : "Content-Range"] = v;
        }
        return new NextResponse(fileRes.body, { status: fileRes.status, headers: h2 });
      }
    }

    // Unrecognised HTML — treat as session expiry
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
