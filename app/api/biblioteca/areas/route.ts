import { NextResponse } from "next/server";
import https from "node:https";

export const runtime = "nodejs";

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET() {
  try {
    const html = await httpsGet("https://turnos.frsfco.utn.edu.ar:4443/");

    const selectMatch = html.match(/<select name="resp"[\s\S]*?<\/select>/);
    if (!selectMatch) return NextResponse.json([], { status: 200 });

    const options: { id: string; label: string; responsable: string }[] = [];
    const regex = /<option\s+value="([^"]+)">\s*([^<]+?)\s*<\/option>/g;
    let match;
    while ((match = regex.exec(selectMatch[0])) !== null) {
      const responsable = decodeEntities(match[1]);
      const slashIdx = responsable.indexOf("/");
      if (slashIdx === -1) continue; // skip the "Seleccione un área" placeholder
      const id = responsable.slice(0, slashIdx);
      const label = decodeEntities(match[2]);
      options.push({ id, label, responsable });
    }

    return NextResponse.json(options);
  } catch (err) {
    console.error("[biblioteca/areas]", (err as Error).message);
    return NextResponse.json([], { status: 200 });
  }
}
