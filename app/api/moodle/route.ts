import { NextRequest, NextResponse } from "next/server";
import { sessionCookieOptions } from "@/lib/cookies";

export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const sesskey = req.cookies.get("moodle_sesskey")?.value;

  if (!sessionToken || !sesskey) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const keep = req.cookies.get("moodle_remember")?.value === "1";

  // Reconstruct the Cookie header from the raw token (avoids encoding issues)
  const moodleCookie = `MoodleSession=${sessionToken}`;

  const { methodname, args } = await req.json();

  console.log("[moodle proxy] calling:", methodname);
  console.log("[moodle proxy] sessionToken (first 8):", sessionToken.slice(0, 8) + "...");
  console.log("[moodle proxy] sesskey (first 8):", sesskey.slice(0, 8) + "...");
  console.log("[moodle proxy] cookie header:", moodleCookie);

  try {
    const raw = await fetch(
      `https://frsfco.cvg.utn.edu.ar/lib/ajax/service.php?sesskey=${sesskey}&info=${methodname}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: moodleCookie,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify([{ index: 0, methodname, args }]),
      }
    );
    console.log("[moodle proxy] Moodle HTTP status:", raw.status);

    // Moodle puede regenerar la sesión en cualquier request: capturamos el token
    // rotado para que las llamadas siguientes no fallen por sesión vencida.
    const rotated = raw.headers.get("set-cookie")?.match(/MoodleSession=([^;]+)/)?.[1];

    const text = await raw.text();
    console.log("[moodle proxy] Moodle raw response:", text.slice(0, 500));
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      console.error("[moodle proxy] response is not JSON");
      return NextResponse.json({ error: "Moodle returned non-JSON response" }, { status: 500 });
    }
    const arr = json as Array<{ error?: boolean; exception?: { message?: string; errorcode?: string }; data?: unknown }>;
    if (arr[0]?.error) {
      const msg = arr[0].exception?.message ?? arr[0].exception?.errorcode ?? "Error de Moodle";
      console.error("[moodle proxy] Moodle error:", msg, arr[0].exception);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    const response = NextResponse.json({ data: arr[0]?.data ?? arr[0] ?? {} });
    // Persistir el token rotado + deslizar la expiración de la sesión con la actividad.
    if (rotated && rotated !== sessionToken) {
      response.cookies.set("moodle_session_token", rotated, sessionCookieOptions(keep, true));
    }
    return response;
  } catch (err) {
    console.error("[moodle proxy] fetch error:", (err as Error).message);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
