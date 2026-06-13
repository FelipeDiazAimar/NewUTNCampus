import { NextRequest, NextResponse } from "next/server";
import https from "node:https";

export const runtime = "nodejs";

function httpsPost(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Content-Length": Buffer.byteLength(body),
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://turnos.frsfco.utn.edu.ar:4443/",
        },
        rejectUnauthorized: false,
      },
      (res) => {
        let data = "";
        res.setEncoding("latin1");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function POST(request: NextRequest) {
  try {
    const { diapicker, area, tematica } = await request.json();

    if (!diapicker || !area || !tematica) {
      return NextResponse.json([], { status: 200 });
    }

    const params = new URLSearchParams({ diapicker, area, tematica });
    const url = `https://turnos.frsfco.utn.edu.ar:4443/funciones/disponibilidad_horarios.php?${params}`;

    const html = await httpsPost(url, params.toString());

    // Parse <option value='ID'> HH:MM</option>
    const options: { value: string; label: string }[] = [];
    const regex = /<option value='(\d+)'>\s*([^<]+?)\s*<\/option>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      options.push({ value: match[1], label: match[2].trim() });
    }

    return NextResponse.json(options);
  } catch (err) {
    console.error("[biblioteca/horarios]", (err as Error).message);
    return NextResponse.json([], { status: 200 });
  }
}
