/**
 * DELETE /api/foro/comments/[id] — Borrar comentario — solo admin
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";
import { isAdminRequest } from "@/lib/adminAuth";

export const runtime = "nodejs";

function isAdmin(req: NextRequest): boolean {
  return isAdminRequest(req);
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
