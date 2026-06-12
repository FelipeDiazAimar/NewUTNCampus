/**
 * GET  /api/foro          — Feed de posts (approved por defecto; pending para admin)
 * POST /api/foro          — Crear nuevo post (entra como 'pending')
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";

const ADMIN_TOKEN = "campus-admin-2024-internal";

function isAdmin(req: NextRequest): boolean {
  return req.cookies.get("admin_session_token")?.value === ADMIN_TOKEN;
}

export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get("view") ?? "approved";

  // Solo el admin puede ver la bandeja de pendientes.
  const status = isAdmin(req) && view === "pending" ? "pending" : "approved";

  const order =
    status === "approved"
      ? "likes_count.desc,created_at.desc"
      : "created_at.desc";

  const res = await supabaseFetch(
    `foro_posts?status=eq.${status}&order=${order}&select=*,foro_comments(*)`
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Error al cargar el foro" }, { status: 500 });
  }

  type RawPost = { foro_comments?: Record<string, unknown>[]; [k: string]: unknown };
  const posts = (await res.json()) as RawPost[];

  // Ordenar comentarios por likes_count desc en el servidor
  const normalized = posts.map((p) => ({
    ...p,
    foro_comments: (p.foro_comments ?? []).sort(
      (a, b) => (b.likes_count as number) - (a.likes_count as number)
    ),
  }));

  return NextResponse.json(normalized);
}

export async function POST(req: NextRequest) {
  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const content = (body.content ?? "").trim();
  if (content.length < 10 || content.length > 1000) {
    return NextResponse.json(
      { error: "El contenido debe tener entre 10 y 1000 caracteres." },
      { status: 422 }
    );
  }

  const res = await supabaseFetch("foro_posts?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ content, status: "pending" }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "No se pudo crear la publicación." }, { status: 500 });
  }

  const [post] = await res.json();
  return NextResponse.json(post, { status: 201 });
}
