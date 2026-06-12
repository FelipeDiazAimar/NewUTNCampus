/**
 * POST /api/foro/comments — Crear un comentario en un post aprobado.
 * Body: { post_id: string, content: string }
 * Las respuestas no requieren moderación, se publican directo.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { post_id?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const postId = (body.post_id ?? "").trim();
  const content = (body.content ?? "").trim();

  if (!postId) {
    return NextResponse.json({ error: "post_id requerido" }, { status: 422 });
  }
  if (content.length < 1 || content.length > 500) {
    return NextResponse.json(
      { error: "El comentario debe tener entre 1 y 500 caracteres." },
      { status: 422 }
    );
  }

  // Verificar que el post al que se responde existe y está aprobado.
  const postRes = await supabaseFetch(
    `foro_posts?id=eq.${encodeURIComponent(postId)}&status=eq.approved&select=id`
  );
  if (!postRes.ok) {
    return NextResponse.json({ error: "Error al verificar el post." }, { status: 500 });
  }
  const posts = await postRes.json();
  if (!Array.isArray(posts) || posts.length === 0) {
    return NextResponse.json({ error: "Post no encontrado o no aprobado." }, { status: 404 });
  }

  const res = await supabaseFetch("foro_comments?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ post_id: postId, content }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "No se pudo crear el comentario." }, { status: 500 });
  }

  const [comment] = await res.json();
  return NextResponse.json(comment, { status: 201 });
}
