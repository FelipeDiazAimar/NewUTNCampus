import { NextRequest, NextResponse } from "next/server";
import https from "node:https";

export const runtime = "nodejs";

const ENVIO_URL = "https://turnos.frsfco.utn.edu.ar:4443/envio/envio_turno.php";

type TurnoBody = {
  responsable: string;
  responsableDesc: string;
  tematica: string;
  tematicaDesc: string;
  fecha: string; // dd/mm/yyyy
  idHorario: string;
  horarioDesc: string;
  tipoasistencia?: string;
  tipo_contacto?: string;
  carrera?: string;
  tipo_documento: string;
  nro_documento: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  localidad: string;
  provincia: string;
  obs?: string;
  recaptcha?: string;
};

/** Build a multipart/form-data body matching the legacy envio_turno.php form. */
function buildMultipart(fields: [string, string][], boundary: string): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of fields) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`,
        "utf8"
      )
    );
  }
  // Empty file part — the legacy form always sends uploadedFile, usually blank
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="uploadedFile"; filename=""\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n\r\n`,
      "utf8"
    )
  );
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(parts);
}

function httpsPostMultipart(
  url: string,
  body: Buffer,
  boundary: string
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          Origin: "https://turnos.frsfco.utn.edu.ar:4443",
          Referer: "https://turnos.frsfco.utn.edu.ar:4443/",
        },
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function POST(request: NextRequest) {
  let b: TurnoBody;
  try {
    b = (await request.json()) as TurnoBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const required: (keyof TurnoBody)[] = [
    "responsable", "tematica", "fecha", "idHorario", "horarioDesc",
    "tipo_documento", "nro_documento", "nombre", "apellido",
    "email", "telefono", "localidad", "provincia",
  ];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return NextResponse.json(
      { ok: false, error: `Faltan campos: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  // The one field the backend actually reads to register the turno
  const turnosLote = JSON.stringify([
    {
      fecha: b.fecha,
      idHorario: b.idHorario,
      horarioDesc: b.horarioDesc,
      idResponsable: b.responsable,
      responsableDesc: b.responsableDesc ?? "",
      idTematica: b.tematica,
      tematicaDesc: b.tematicaDesc ?? "",
    },
  ]);

  const boundary =
    "----CampusUTNFormBoundary" + Math.random().toString(16).slice(2);

  // Field order mirrors the legacy form / HAR capture
  const fields: [string, string][] = [
    ["responsable", b.responsable],
    ["tematica", b.tematica],
    ["obs", b.obs ?? ""],
    ["datepicker", b.fecha],
    ["horarios", ""], // legacy sends this empty; the horario lives in turnos_lote
    ["turnos_lote", turnosLote],
    ["tipoasistencia", b.tipoasistencia ?? "Presencial"],
    ["tipo_contacto", b.tipo_contacto ?? "Cursante"],
    ["carrera", b.carrera ?? ""],
    ["tipo_documento", b.tipo_documento],
    ["nro_documento", b.nro_documento],
    ["nombre", b.nombre],
    ["apellido", b.apellido],
    ["email", b.email],
    ["telefono", b.telefono],
    ["localidad", b.localidad],
    ["provincia", b.provincia],
    ["g-recaptcha-response", b.recaptcha ?? ""],
    ["enviar", "Solicitar Turno"],
  ];

  const payload = buildMultipart(fields, boundary);

  let res: { status: number; text: string };
  try {
    res = await httpsPostMultipart(ENVIO_URL, payload, boundary);
  } catch (err) {
    console.error("[biblioteca/turno] network error", (err as Error).message);
    return NextResponse.json(
      { ok: false, error: "No se pudo contactar al campus" },
      { status: 502 }
    );
  }

  const html = res.text;
  const confirmed = /ya se encuentra ingresado/i.test(html);

  // Legacy reports failures via an inline alert("..."); pull the message out
  const alertMatch = html.match(/alert\(\s*["']([^"']+)["']\s*\)/i);
  const reason = alertMatch ? alertMatch[1].trim() : undefined;

  if (!confirmed) {
    console.error(
      "[biblioteca/turno] no confirmado. status=%d reason=%s body=%s",
      res.status,
      reason ?? "(sin alert)",
      html.slice(0, 2000)
    );
  }

  return NextResponse.json({
    ok: confirmed,
    status: res.status,
    reason,
    // Raw legacy HTML so the client/logs can show the full response if needed
    html,
  });
}
