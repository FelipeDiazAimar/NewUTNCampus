import { NextRequest, NextResponse } from "next/server";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

function isExternal(u: string) {
  return (
    !u.includes("frsfco.cvg.utn.edu.ar") &&
    !u.endsWith(".css") && !u.endsWith(".js") &&
    !u.includes("google.com/fonts") && !u.includes("googleapis.com") &&
    !u.includes("gstatic.com") && !u.includes("moodle.org") &&
    !u.includes("/login") && !u.includes("privacy") && !u.includes("bootstrap")
  );
}

function extractFromHtml(html: string): string | null {
  // Slice to main content only — the Moodle page layout puts sidebars (which contain
  // "Links UTN" → ria.utn.edu.ar, etc.) BEFORE #region-main in the DOM. If we
  // search the full HTML we always pick those sidebar links first.
  const mainIdx = html.indexOf('id="region-main"');
  const contentHtml = mainIdx !== -1 ? html.slice(mainIdx) : html;

  // Priority 1: meta-refresh
  const metaUrl = html.match(/content=["'][^"']*?url=([^"']+)["']/i)?.[1];
  if (metaUrl) {
    const t = metaUrl.startsWith("http") ? metaUrl : `${MOODLE_BASE}${metaUrl}`;
    if (isExternal(t)) return t;
  }

  // Priority 2: JS location redirect
  const jsUrl = html.match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/)?.[1];
  if (jsUrl?.startsWith("http") && isExternal(jsUrl)) return jsUrl;

  // Priority 3: urlworkaround / resourceworkaround div (Moodle's URL-module container)
  const workaround = contentHtml.match(
    /class="[^"]*(?:url|resource)workaround[^"]*"[\s\S]{0,2000}?href="(https?:\/\/[^"]+)"/
  )?.[1];
  if (workaround && isExternal(workaround)) return workaround;

  // Priority 4: any external link inside region-main
  for (const m of contentHtml.matchAll(/href="(https?:\/\/[^"#?][^"]*?)"/g)) {
    if (isExternal(m[1])) return m[1];
  }

  return null;
}

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

    // 3xx redirect — if it leaves Moodle we have our answer immediately
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = loc.startsWith("http") ? loc : `${MOODLE_BASE}${loc}`;
      if (!current.includes("frsfco.cvg.utn.edu.ar")) {
        return NextResponse.json({ url: current });
      }
      continue;
    }

    // 200 — parse for the real URL inside the page
    if (res.status === 200) {
      const html = await res.text();
      const found = extractFromHtml(html);

      if (found && found !== current) {
        // If it's still a Moodle URL, follow it; otherwise return it
        if (found.includes("frsfco.cvg.utn.edu.ar")) {
          current = found;
          continue;
        }
        return NextResponse.json({ url: found });
      }
    }

    break;
  }

  return NextResponse.json({ url });
}
