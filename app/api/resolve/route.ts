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

  for (let i = 0; i < 6; i++) {
    let res: Response;
    try {
      res = await fetch(current, { headers: { Cookie: cookie }, redirect: "manual" });
    } catch {
      break;
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = loc.startsWith("http") ? loc : `${MOODLE_BASE}${loc}`;
      if (!current.includes("frsfco.cvg.utn.edu.ar")) {
        return NextResponse.json({ url: current });
      }
      continue;
    }

    if (res.status === 200) {
      const html = await res.text();

      // meta-refresh redirect
      const metaUrl = html.match(/content=["'][^"']*?url=([^"']+)["']/i)?.[1];
      if (metaUrl) {
        const target = metaUrl.startsWith("http") ? metaUrl : `${MOODLE_BASE}${metaUrl}`;
        if (!target.includes("frsfco.cvg.utn.edu.ar")) return NextResponse.json({ url: target });
        current = target;
        continue;
      }

      // JS location redirect
      const jsUrl = html.match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/)?.[1];
      if (jsUrl?.startsWith("http") && !jsUrl.includes("frsfco.cvg.utn.edu.ar")) {
        return NextResponse.json({ url: jsUrl });
      }

      // External links in page content
      const external = [...html.matchAll(/href="(https?:\/\/(?!frsfco\.cvg\.utn\.edu\.ar)[^"#?][^"]*?)"/g)]
        .map((m) => m[1])
        .filter(
          (u) =>
            !u.endsWith(".css") && !u.endsWith(".js") &&
            !u.includes("google.com/fonts") && !u.includes("googleapis.com") &&
            !u.includes("gstatic.com") && !u.includes("moodle.org") &&
            !u.includes("/login") && !u.includes("privacy") && !u.includes("bootstrap")
        );

      if (external.length > 0) return NextResponse.json({ url: external[0] });
    }

    break;
  }

  return NextResponse.json({ url });
}
