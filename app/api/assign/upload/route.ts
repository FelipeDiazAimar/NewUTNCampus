import { NextRequest, NextResponse } from "next/server";
import {
  getSubmissionContext,
  uploadDraftFile,
  submitAssignment,
} from "@/lib/assign";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const cookie = `MoodleSession=${sessionToken}`;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
  }

  const cmid = String(form.get("tareaId") ?? form.get("itemid") ?? "");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!cmid) {
    return NextResponse.json({ error: "Falta el id de la tarea." }, { status: 400 });
  }
  if (files.length === 0) {
    return NextResponse.json({ error: "No se recibieron archivos." }, { status: 400 });
  }

  try {
    // 1. Contexto de entrega (itemid, sesskey, repo, límites, hidden del form).
    const ctx = await getSubmissionContext(cookie, cmid);

    if (files.length > ctx.maxFiles) {
      return NextResponse.json(
        { error: `Máximo ${ctx.maxFiles} archivos.` },
        { status: 400 }
      );
    }
    const tooBig = files.find((f) => f.size > ctx.maxBytes);
    if (tooBig) {
      return NextResponse.json(
        { error: `"${tooBig.name}" supera el tamaño máximo permitido.` },
        { status: 400 }
      );
    }

    // 2. Subir cada archivo al área draft (secuencial: comparten itemid).
    const uploaded: string[] = [];
    for (const file of files) {
      uploaded.push(await uploadDraftFile(cookie, ctx, file));
    }

    // 3. Confirmar la entrega.
    await submitAssignment(cookie, ctx);

    return NextResponse.json({ ok: true, uploaded });
  } catch (err) {
    const message = (err as Error).message;
    const expired = message.includes("expirada");
    console.error("[assign-upload] error:", message);
    return NextResponse.json({ error: message }, { status: expired ? 401 : 500 });
  }
}
