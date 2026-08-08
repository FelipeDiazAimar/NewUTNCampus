import { NextRequest, NextResponse } from "next/server";

import { MOODLE_BASE, decodeContentDispositionFilename } from "@/lib/moodle";
import { decodeUrlRef } from "@/lib/urlToken";

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const ref = req.nextUrl.searchParams.get("ref");
  const url = ref ? decodeUrlRef(ref) : null;

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
    const fromDisp = decodeContentDispositionFilename(disp);
    const fromUrl  = current.split("/").pop()?.split("?")[0];
    // Never return a PHP script as the filename — it means we stopped at a redirect page.
    const filename = fromDisp ?? decodeURIComponent((fromUrl && !fromUrl.endsWith(".php") ? fromUrl : undefined) ?? "archivo");

    return NextResponse.json({ contentType, filename });
  }

  return NextResponse.json({ contentType: "application/octet-stream", filename: "archivo" });
}
