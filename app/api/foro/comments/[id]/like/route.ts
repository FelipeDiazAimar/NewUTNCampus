/**
 * POST /api/foro/comments/[id]/like — Incremento atómico de likes en un comentario.
 * Body: { delta: 1 | -1 }
 * Usa la función SQL `increment_comment_likes` para evitar race conditions.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let delta = 1;
  try {
    const body = await req.json();
    if (body.delta === -1) delta = -1;
  } catch {
    // delta por defecto = 1
  }

  const res = await supabaseFetch("rpc/increment_comment_likes", {
    method: "POST",
    body: JSON.stringify({ c_id: id, delta }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "No se pudo actualizar el like." }, { status: 500 });
  }

  const newCount = await res.json();
  return NextResponse.json({ likes_count: newCount });
}
