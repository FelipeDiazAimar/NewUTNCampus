import { NextRequest, NextResponse } from "next/server";
import { removeSubmission } from "@/lib/assign";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { cmid } = await req.json().catch(() => ({}));
  if (!cmid) {
    return NextResponse.json({ error: "Falta el id de la tarea." }, { status: 400 });
  }

  try {
    await removeSubmission(`MoodleSession=${sessionToken}`, String(cmid));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = (err as Error).message;
    const expired = message.includes("expirada");
    console.error("[assign-remove] error:", message);
    return NextResponse.json({ error: message }, { status: expired ? 401 : 500 });
  }
}
