import { NextRequest, NextResponse } from "next/server";
import { callMoodleService } from "@/lib/moodle";

export const runtime = "nodejs";

function getAuth(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  if (!sessionToken) return null;
  const sesskey = req.cookies.get("moodle_sesskey")?.value ?? "";
  let userid = 0;
  try {
    userid = Number(JSON.parse(req.cookies.get("moodle_user")?.value ?? "{}").userid) || 0;
  } catch { /* ignore */ }
  return { cookie: `MoodleSession=${sessionToken}`, sesskey, userid };
}

interface MoodleSearchUser {
  id: number;
  fullname: string;
  profileimageurl?: string;
  profileimageurlsmall?: string;
}

interface SearchResult {
  id: number;
  name: string;
  avatarUrl: string | null;
}

/**
 * GET /api/chat/search-users?q=<query>
 * Calls core_message_message_search_users and returns contacts + noncontacts.
 */
export async function GET(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth?.userid) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ contacts: [], noncontacts: [] });

  try {
    const data = (await callMoodleService(
      auth.cookie,
      auth.sesskey,
      "core_message_message_search_users",
      { userid: auth.userid, search: q, limitnum: 10, limitfrom: 0 }
    )) as { contacts: MoodleSearchUser[]; noncontacts: MoodleSearchUser[] };

    const map = (u: MoodleSearchUser): SearchResult => ({
      id: u.id,
      name: u.fullname,
      avatarUrl: u.profileimageurl ?? u.profileimageurlsmall ?? null,
    });

    return NextResponse.json({
      contacts: (data.contacts ?? []).map(map),
      noncontacts: (data.noncontacts ?? []).map(map),
    });
  } catch (err) {
    console.error("[chat/search-users]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
