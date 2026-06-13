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

export async function GET(request: NextRequest) {
  const responsable = request.nextUrl.searchParams.get("responsable") ?? "";

  try {
    // Keep literal "/" in query value — server expects "23/BIBLIOTECA - Uso Salas " not "23%2FBIBLIOTECA..."
    const responsableForUrl = responsable
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/");

    const url = `https://turnos.frsfco.utn.edu.ar:4443/funciones/ListarTematicas.php?responsable=${responsableForUrl}`;
    const body = new URLSearchParams({ responsable }).toString();

    const html = await httpsPost(url, body);

    // Parse <option value="ID/DESC"> DESC </option>
    const options: { value: string; label: string }[] = [];
    const regex = /<option value="([^"]+)">([^<]+)<\/option>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const fullValue = match[1];
      const label = match[2].trim();
      if (!fullValue) continue;
      const slashIdx = fullValue.indexOf("/");
      const value = slashIdx > -1 ? fullValue.slice(0, slashIdx) : fullValue;
      options.push({ value, label });
    }

    return NextResponse.json(options);
  } catch (err) {
    console.error("[biblioteca/tematicas]", (err as Error).message);
    return NextResponse.json([], { status: 200 });
  }
}
