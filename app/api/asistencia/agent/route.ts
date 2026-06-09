import { NextRequest, NextResponse } from "next/server";
import { supabaseFetch } from "@/lib/supabase";

export const runtime = "nodejs";

type AgentRow = {
  agent_id: string;
  status: "listening" | "detected" | "idle" | "offline";
  last_seen_at: string | null;
  last_payload: unknown;
};

export async function GET() {
  const res = await supabaseFetch(
    "asistencia_agent_status?agent_id=eq.motorola-local&select=agent_id,status,last_seen_at,last_payload"
  );

  if (!res.ok) {
    return NextResponse.json({
      status: "offline",
      listening: false,
      error: "Tabla asistencia_agent_status no disponible",
    });
  }

  const rows = (await res.json()) as AgentRow[];
  const row = rows[0];
  const lastSeen = row?.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  const fresh = Date.now() - lastSeen < 5 * 60_000;
  const status = fresh ? row.status : "offline";

  return NextResponse.json({
    status,
    listening: fresh && row.status === "listening",
    lastSeenAt: row?.last_seen_at ?? null,
    payload: row?.last_payload ?? null,
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFICATIONS_WEBHOOK_SECRET ?? "";
  const provided = req.headers.get("x-agent-secret") ?? "";
  if (secret && secret !== provided) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  const row = {
    agent_id: "motorola-local",
    status: body.status ?? "listening",
    last_seen_at: now,
    last_payload: body,
    updated_at: now,
  };

  const res = await supabaseFetch("asistencia_agent_status?on_conflict=agent_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "No se pudo actualizar el agente" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
