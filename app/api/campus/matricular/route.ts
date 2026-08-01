import { NextRequest, NextResponse } from "next/server";
import { isGuestRequest } from "@/lib/guest";
import { decodeEntities, stripTags } from "@/lib/campus";

export const runtime = "nodejs";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

/** El <form> de la página de matriculación que pide la clave. */
function formConClave(html: string): string | null {
  const forms = html.match(/<form[\s\S]*?<\/form>/gi) ?? [];
  return forms.find((f) => /name="enrolpassword"/i.test(f)) ?? null;
}

/**
 * Reenvía TODOS los ocultos del formulario tal cual vinieron. No alcanza con
 * mandar la clave: `instance` (la instancia de matriculación) es distinta en
 * cada curso, y `sesskey` cambia por sesión.
 */
function camposOcultos(form: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /<input[^>]*type="hidden"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(form)) !== null) {
    const name = m[0].match(/name="([^"]*)"/)?.[1];
    if (!name) continue;
    out.push([name, decodeEntities(m[0].match(/value="([^"]*)"/)?.[1] ?? "")]);
  }
  return out;
}

function botonSubmit(form: string): [string, string] | null {
  const tag = form.match(/<input[^>]*type="submit"[^>]*>/i)?.[0];
  const name = tag?.match(/name="([^"]*)"/)?.[1];
  if (!name) return null;
  return [name, decodeEntities(tag?.match(/value="([^"]*)"/)?.[1] ?? "")];
}

function mensajeDeError(html: string): string | null {
  const alerta = html.match(/class="[^"]*alert-danger[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const texto = alerta ? stripTags(alerta) : "";
  if (texto) return texto;
  const campo = html.match(
    /class="[^"]*(?:form-control-feedback|invalid-feedback|error)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i
  )?.[1];
  const t2 = campo ? stripTags(campo) : "";
  return t2 || null;
}

const esRedirA = (res: Response, patron: RegExp) =>
  res.status >= 300 && res.status < 400 && patron.test(res.headers.get("location") ?? "");

export async function POST(req: NextRequest) {
  if (isGuestRequest(req)) {
    return NextResponse.json({ error: "No disponible en modo invitado." }, { status: 403 });
  }

  const token = req.cookies.get("moodle_session_token")?.value;
  if (!token) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const { courseId, clave } = (await req.json().catch(() => ({}))) as {
    courseId?: string;
    clave?: string;
  };
  if (!/^\d+$/.test(String(courseId ?? ""))) {
    return NextResponse.json({ error: "Curso inválido." }, { status: 400 });
  }
  if (!clave) return NextResponse.json({ error: "Falta la clave." }, { status: 400 });

  const cookie = `MoodleSession=${token}`;
  const comun = {
    headers: { Cookie: cookie },
    redirect: "manual" as const,
    cache: "no-store" as const,
  };

  try {
    // 1. Traer el formulario. Si ya está matriculado, Moodle manda al curso.
    const getRes = await fetch(`${MOODLE_BASE}/enrol/index.php?id=${courseId}`, comun);
    if (esRedirA(getRes, /course\/view\.php/)) {
      return NextResponse.json({ ok: true, yaMatriculado: true });
    }

    const form = formConClave(await getRes.text());
    if (!form) {
      return NextResponse.json({
        ok: false,
        motivo: "El curso no acepta auto-matriculación con clave.",
      });
    }

    // 2. Reenviar los ocultos + la clave.
    const body = new URLSearchParams();
    for (const [n, v] of camposOcultos(form)) body.set(n, v);
    const submit = botonSubmit(form);
    if (submit) body.set(submit[0], submit[1]);
    body.set("enrolpassword", clave);

    const postRes = await fetch(`${MOODLE_BASE}/enrol/index.php`, {
      ...comun,
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (esRedirA(postRes, /course\/view\.php/)) return NextResponse.json({ ok: true });

    const motivo = mensajeDeError(await postRes.text()) ?? "La clave no fue aceptada.";
    return NextResponse.json({ ok: false, motivo });
  } catch (err) {
    console.error("[campus-matricular]", (err as Error).message);
    return NextResponse.json({ ok: false, motivo: "No se pudo conectar con el campus." });
  }
}
