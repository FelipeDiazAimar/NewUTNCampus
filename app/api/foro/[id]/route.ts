/**
 * PATCH /api/foro/[id]   — Moderar post (approve | reject) — solo admin
 * DELETE /api/foro/[id]  — Borrar post — solo admin
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";

const ADMIN_TOKEN = "campus-admin-2024-internal";

function isAdmin(req: NextRequest): boolean {
  return req.cookies.get("admin_session_token")?.value === ADMIN_TOKEN;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (body.status !== "approved" && body.status !== "rejected") {
    return NextResponse.json({ error: "Status inválido" }, { status: 422 });
  }

  const res = await supabaseFetch(
    `foro_posts?id=eq.${encodeURIComponent(id)}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: body.status }),
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "No se pudo moderar el post." }, { status: 500 });
  }

  const [post] = await res.json();
  return NextResponse.json(post ?? { ok: true });
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
    `foro_posts?id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "No se pudo borrar el post." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
