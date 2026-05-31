import { NextRequest, NextResponse } from "next/server";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

// Follow up to N redirects manually so the Cookie header is preserved on every hop.
// fetch()'s built-in redirect:"follow" drops custom headers on cross-hop redirects.
async function fetchWithCookie(url: string, cookie: string, maxRedirects = 5): Promise<Response> {
  let current = url;
  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetch(current, {
      headers: { Cookie: cookie },
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
  const res = await fetchWithCookie(fileurl, cookie);

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const upstreamDisp = res.headers.get("content-disposition") ?? "";
  // inline=1 → let the browser display the file; otherwise force download
  const disposition = inline ? "inline" : upstreamDisp || "attachment";
  const body = await res.arrayBuffer();

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
    },
  });
}
