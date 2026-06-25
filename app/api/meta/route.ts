import { NextRequest, NextResponse } from "next/server";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const url = req.nextUrl.searchParams.get("url");

  if (!sessionToken || !url) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const cookie = `MoodleSession=${sessionToken}`;
  let current = url;

  // Follow redirects with HEAD to get the final content-type without downloading the file
  for (let i = 0; i < 6; i++) {
    const res = await fetch(current, {
      method: "HEAD",
      headers: { Cookie: cookie },
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = loc.startsWith("http") ? loc : `${MOODLE_BASE}${loc}`;
      continue;
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const disp = res.headers.get("content-disposition") ?? "";
    const fromDisp = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i)?.[1];
    const fromUrl  = current.split("/").pop()?.split("?")[0];
    // Never return a PHP script as the filename — it means we stopped at a redirect page.
    const raw = fromDisp ?? (fromUrl && !fromUrl.endsWith(".php") ? fromUrl : undefined) ?? "archivo";
    const filename = decodeURIComponent(raw);

    return NextResponse.json({ contentType, filename });
  }

  return NextResponse.json({ contentType: "application/octet-stream", filename: "archivo" });
}
