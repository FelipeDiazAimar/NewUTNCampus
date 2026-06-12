/**
 * DELETE /api/foro/comments/[id] — Borrar comentario — solo admin
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";

const ADMIN_TOKEN = "campus-admin-2024-internal";

function isAdmin(req: NextRequest): boolean {
  return req.cookies.get("admin_session_token")?.value === ADMIN_TOKEN;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;

  const res = await supabaseFetch(
    `foro_comments?id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "No se pudo borrar el comentario." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
