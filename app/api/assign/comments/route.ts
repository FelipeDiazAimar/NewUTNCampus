import { NextRequest, NextResponse } from "next/server";
import { getComments, addComment, type CommentMeta } from "@/lib/assign";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const sesskey = req.cookies.get("moodle_sesskey")?.value;
  if (!sessionToken || !sesskey) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const meta = body.meta as CommentMeta | undefined;
  if (!meta?.itemid || !meta?.contextid) {
    return NextResponse.json({ error: "Faltan datos del comentario." }, { status: 400 });
  }

  const cookie = `MoodleSession=${sessionToken}`;
  try {
    if (body.action === "add") {
      const content = String(body.content ?? "").trim();
      if (!content) {
        return NextResponse.json({ error: "El comentario está vacío." }, { status: 400 });
      }
      const comments = await addComment(cookie, sesskey, meta, content);
      return NextResponse.json({ comments });
    }

    const comments = await getComments(cookie, sesskey, meta, Number(body.page ?? 0));
    return NextResponse.json({ comments });
  } catch (err) {
    console.error("[assign-comments] error:", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
