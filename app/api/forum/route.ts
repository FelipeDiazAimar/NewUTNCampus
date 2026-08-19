import { NextRequest, NextResponse } from "next/server";
import { MOODLE_BASE, toProxyPath } from "@/lib/moodle";
import type { MoodleForumDiscussion } from "@/lib/moodle";

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string) {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

/** Parses the discussion-list table from mod/forum/view.php into rows. */
function parseDiscussionList(html: string): MoodleForumDiscussion[] {
  const discussions: MoodleForumDiscussion[] = [];
  const positions = [...html.matchAll(/<tr class="discussion[^"]*"/g)];

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index!;
    const end = positions[i + 1]?.index ?? html.indexOf("</tbody>", start);
    const chunk = html.slice(start, end === -1 ? html.length : end);

    const id = parseInt(chunk.match(/data-discussionid="(\d+)"/)?.[1] ?? "");
    if (!id) continue;

    const subjectRaw =
      chunk.match(/<a class="[^"]*d-block[^"]*"[^>]*href="[^"]*discuss\.php\?d=\d+"[^>]*title="([^"]+)"/)?.[1] ??
      stripTags(chunk.match(/<a[^>]*href="[^"]*discuss\.php\?d=\d+"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "");
    const subject = decodeEntities(subjectRaw) || "Sin título";

    // First "author-info" block in the row is the "Comenzado por" column.
    const authorName = decodeEntities(
      chunk.match(/class="mb-1 line-height-3 text-truncate">([^<]+)</)?.[1] ?? ""
    ).trim() || "—";
    const avatarRaw = chunk.match(/<img class="rounded-circle userpicture" src="([^"]+)"/)?.[1];
    const authorAvatar = avatarRaw ? toProxyPath(decodeEntities(avatarRaw)) : undefined;

    const timeText = decodeEntities(
      chunk.match(/<time[^>]*data-timestamp="\d+"[^>]*>\s*([^<]+)</)?.[1] ?? ""
    ).trim();

    const replies = parseInt(
      chunk.match(/class="p-0 text-center align-middle fit-content px-2">\s*<span>(\d+)<\/span>/)?.[1] ?? "0"
    );

    const lockedTag = chunk.match(/data-region="locked-label"([^>]*)>/)?.[1] ?? "";
    const locked = !lockedTag.includes("hidden");

    discussions.push({ id, subject, authorName, authorAvatar, timeText, replies, locked });
  }

  return discussions;
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const id = req.nextUrl.searchParams.get("id");

  if (!sessionToken || !id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const cookie = `MoodleSession=${sessionToken}`;

  try {
    const res = await fetch(`${MOODLE_BASE}/mod/forum/view.php?id=${id}`, {
      headers: { Cookie: cookie },
    });
    if (res.url.includes("/login/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const html = await res.text();
    const discussions = parseDiscussionList(html);

    return NextResponse.json({ discussions });
  } catch (err) {
    console.error("[forum]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
