import { NextRequest, NextResponse } from "next/server";
import { type SysacadAuth, cambiarPassword } from "@/lib/sysacad";

function getAuth(req: NextRequest): SysacadAuth | null {
  const raw = req.cookies.get("sysacad_session")?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SysacadAuth;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "No autenticado en Sysacad" }, { status: 401 });
  }

  const { actual, nueva, repetir } = await req.json();
  if (!actual || !nueva || !repetir) {
    return NextResponse.json({ error: "Completá todos los campos." }, { status: 400 });
  }
  if (nueva !== repetir) {
    return NextResponse.json({ error: "La nueva contraseña no coincide." }, { status: 400 });
  }

  try {
    const result = await cambiarPassword(auth, String(actual), String(nueva));
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    console.error("[sysacad-api] password error:", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
