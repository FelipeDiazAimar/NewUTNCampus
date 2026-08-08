import { NextRequest, NextResponse } from "next/server";
import { sessionCookieOptions } from "@/lib/cookies";
import { isGuestRequest } from "@/lib/guest";
import { MOCK_COURSES, MOCK_CONVERSATIONS, MOCK_SEARCH_USERS } from "@/lib/guestMockData";
import { MOODLE_BASE, rewriteMoodleUrlsDeep } from "@/lib/moodle";
import { getCachedCourses, setCachedCourses } from "@/lib/contentCache";

const COURSE_LIST_METHODS = new Set([
  "core_course_get_enrolled_courses_by_timeline_classification",
  "core_enrol_get_users_courses",
]);

function getUserId(req: NextRequest): number | undefined {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { userid?: number };
    return parsed.userid;
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  // ── Guest mode: return mock data without hitting Moodle ─────────────────────
  if (isGuestRequest(req)) {
    const body = await req.json().catch(() => ({}));
    const methodname: string = body?.methodname ?? "";

    if (methodname === "core_course_get_enrolled_courses_by_timeline_classification" ||
        methodname === "core_enrol_get_users_courses") {
      return NextResponse.json({ data: MOCK_COURSES });
    }
    if (methodname === "core_message_get_conversations") {
      return NextResponse.json({ data: { conversations: MOCK_CONVERSATIONS } });
    }
    if (methodname === "core_message_message_search_users") {
      const q: string = (body?.args?.search ?? "").toLowerCase();
      const filtered = MOCK_SEARCH_USERS.filter((u) =>
        (u.fullname as string).toLowerCase().includes(q)
      );
      return NextResponse.json({ data: { contacts: [], noncontacts: filtered } });
    }
    if (methodname === "core_message_send_instant_messages" ||
        methodname === "core_message_send_messages_to_conversation") {
      return NextResponse.json(
        { error: "Esta acción no está disponible en modo invitado." },
        { status: 403 }
      );
    }
    // No-op for read/notification methods
    return NextResponse.json({ data: {} });
  }

  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const sesskey = req.cookies.get("moodle_sesskey")?.value;

  if (!sessionToken || !sesskey) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const keep = req.cookies.get("moodle_remember")?.value === "1";

  // Reconstruct the Cookie header from the raw token (avoids encoding issues)
  const moodleCookie = `MoodleSession=${sessionToken}`;

  const { methodname, args } = await req.json();
  const userId = getUserId(req);
  const isCourseList = COURSE_LIST_METHODS.has(methodname);

  try {
    const raw = await fetch(
      `${MOODLE_BASE}/lib/ajax/service.php?sesskey=${sesskey}&info=${methodname}`,
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
    if (raw.status >= 500) {
      // Moodle caído a nivel servidor: tratarlo igual que un error de red,
      // para que el catch de abajo intente el respaldo en cache (solo aplica
      // a isCourseList — el resto de los métodos simplemente fallan).
      throw new Error(`Moodle respondió ${raw.status}`);
    }
    // Moodle puede regenerar la sesión en cualquier request: capturamos el token
    // rotado para que las llamadas siguientes no fallen por sesión vencida.
    const rotated = raw.headers.get("set-cookie")?.match(/MoodleSession=([^;]+)/)?.[1];

    const text = await raw.text();
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
    const data = rewriteMoodleUrlsDeep(arr[0]?.data ?? arr[0] ?? {});
    if (isCourseList && userId) {
      const courses = (data as { courses?: unknown }).courses ?? data;
      if (Array.isArray(courses) && courses.length > 0) {
        setCachedCourses(userId, courses as Parameters<typeof setCachedCourses>[1]);
      }
    }
    const response = NextResponse.json({ data });
    // Persistir el token rotado + deslizar la expiración de la sesión con la actividad.
    if (rotated && rotated !== sessionToken) {
      response.cookies.set("moodle_session_token", rotated, sessionCookieOptions(keep, true));
    }
    return response;
  } catch (err) {
    console.error("[moodle proxy] fetch error:", (err as Error).message);
    if (isCourseList && userId) {
      const cached = await getCachedCourses(userId);
      if (cached) {
        return NextResponse.json({
          data:
            methodname === "core_course_get_enrolled_courses_by_timeline_classification"
              ? { courses: cached }
              : cached,
        });
      }
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
