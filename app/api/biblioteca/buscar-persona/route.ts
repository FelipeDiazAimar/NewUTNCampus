// Autocompletado de datos personales por DNI, como en la página original de
// turnos (onBlur del nro_documento => funciones/buscar_persona.php).
// Respuesta legacy: {"status":"found","nombre":...,"apellido":...,
//   "tipo_documento":"DNI","email":...,"telefono":...,"localidad":...,"provincia":...}

import { NextRequest, NextResponse } from "next/server";
import https from "node:https";

export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers: {
          "User-Agent": UA,
          Referer: "https://turnos.frsfco.utn.edu.ar:4443/",
        },
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

export async function GET(request: NextRequest) {
  const dni = (request.nextUrl.searchParams.get("dni") ?? "").trim();

  if (!/^\d{6,15}$/.test(dni)) {
    return NextResponse.json({ status: "invalid" }, { status: 200 });
  }

  try {
    const resp = await httpsGet(
      `https://turnos.frsfco.utn.edu.ar:4443/funciones/buscar_persona.php?dni=${dni}`
    );
    const json = JSON.parse(resp) as { status?: string };
    if (json.status !== "found") {
      return NextResponse.json({ status: "not_found" }, { status: 200 });
    }
    return NextResponse.json(json);
  } catch (err) {
    console.error("[biblioteca/buscar-persona]", (err as Error).message);
    return NextResponse.json({ status: "error" }, { status: 200 });
  }
}
