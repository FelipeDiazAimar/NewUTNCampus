import { NextRequest, NextResponse } from "next/server";
import { MOODLE_BASE, toProxyPath, rewriteMoodleHtml } from "@/lib/moodle";
import type { MoodleForumPost } from "@/lib/moodle";

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Same sanitizer as course/route.ts's summary HTML — user-authored rich text
 *  (post bodies) needs the same scrub before it's ever dangerouslySetInnerHTML'd. */
function sanitizePostHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[^>]*>/gi, "")
    .replace(/\s+on\w+="[^"]*"/gi, "")
    .replace(/\s+on\w+='[^']*'/gi, "")
    .replace(/href="javascript:[^"]*"/gi, 'href="#"')
    .replace(/\s+style="[^"]*"/gi, "")
    .replace(/\s+class="[^"]*"/gi, "")
    .trim();
}

/** Walk an HTML string and return content up to the matching closing </div>. */
function extractUntilClosingDiv(html: string): string {
  let depth = 1, i = 0;
  while (i < html.length && depth > 0) {
    const o = html.indexOf("<div", i);
    const c = html.indexOf("</div>", i);
    if (c === -1) break;
    if (o !== -1 && o < c) { depth++; i = o + 4; }
    else { depth--; if (depth === 0) return html.slice(0, c); i = c + 6; }
  }
  return html.split("</div>")[0];
}

/** Parses every <article data-post-id="N"> in a discuss.php page. Works for
 *  both the opening post and any replies, since Moodle renders both the same
 *  way — each post's own header/content always precedes its nested
 *  replies-container div (if it has replies), so slicing up to that div's
 *  start (or a generous fallback) keeps a post's own content isolated from
 *  its children without needing full recursive thread parsing. */
function parseForumPosts(html: string): MoodleForumPost[] {
  const posts: MoodleForumPost[] = [];
  const positions = [...html.matchAll(/<article\b[^>]*\bdata-post-id="(\d+)"/g)];

  for (const m of positions) {
    const id = parseInt(m[1]);
    const start = m.index!;
    const repliesIdx = html.indexOf('data-region="replies-container"', start);
    const chunkEnd = repliesIdx !== -1 ? repliesIdx : Math.min(start + 20000, html.length);
    const chunk = html.slice(start, chunkEnd);

    const subject = decodeEntities(
      chunk.match(/data-region-content="forum-post-core-subject"[^>]*>([^<]+)</)?.[1] ?? ""
    ).trim();

    const authorMatch = chunk.match(/<a href="[^"]*\/user\/view\.php\?id=\d+[^"]*">([^<]+)<\/a>\s*-\s*<time/);
    const authorName = decodeEntities(authorMatch?.[1] ?? "").trim() || "—";

    const avatarRaw = chunk.match(/<img[^>]*class="rounded-circle w-100"[^>]*src="([^"]+)"/)?.[1];
    const authorAvatar = avatarRaw ? toProxyPath(decodeEntities(avatarRaw)) : undefined;

    const timeText = decodeEntities(
      chunk.match(/<time[^>]*datetime="[^"]*"[^>]*>([^<]+)<\/time>/)?.[1] ?? ""
    ).trim();

    let contentHtml = "";
    const marker = `id="post-content-${id}"`;
    const markerIdx = chunk.indexOf(marker);
    if (markerIdx !== -1) {
      const tagEnd = chunk.indexOf(">", markerIdx) + 1;
      if (tagEnd > 0) {
        contentHtml = rewriteMoodleHtml(sanitizePostHtml(extractUntilClosingDiv(chunk.slice(tagEnd)).trim()));
      }
    }

    posts.push({ id, subject, authorName, authorAvatar, timeText, contentHtml });
  }

  return posts;
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const id = req.nextUrl.searchParams.get("id");

  if (!sessionToken || !id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const cookie = `MoodleSession=${sessionToken}`;

  try {
    const res = await fetch(`${MOODLE_BASE}/mod/forum/discuss.php?d=${id}`, {
      headers: { Cookie: cookie },
    });
    if (res.url.includes("/login/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const html = await res.text();
    const posts = parseForumPosts(html);

    return NextResponse.json({ posts });
  } catch (err) {
    console.error("[forum/discuss]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
