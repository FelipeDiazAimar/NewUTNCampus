import { NextRequest, NextResponse } from "next/server";

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function decode(s: string) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, " ");
}

export interface AssignDate { label: string; value: string }
export interface AssignRow  { label: string; value: string }
export interface AssignInfo {
  title: string;
  dates: AssignDate[];
  rows: AssignRow[];
  description: string;
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const url = req.nextUrl.searchParams.get("url");
  if (!sessionToken || !url) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const cookie = `MoodleSession=${sessionToken}`;
  try {
    const res = await fetch(url, { headers: { Cookie: cookie } });
    if (res.url.includes("/login/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const html = await res.text();

    // Title — first h2 in main content
    const title = decode(html.match(/<h2[^>]*>([^<]+)<\/h2>/)?.[1]?.trim() ?? "");

    // Activity dates (data-region="activity-dates")
    const dates: AssignDate[] = [];
    const dateIdx = html.indexOf('data-region="activity-dates"');
    if (dateIdx !== -1) {
      const chunk = html.slice(dateIdx, dateIdx + 600);
      for (const m of chunk.matchAll(/<strong>([^<]+)<\/strong>\s*([^<]{3,100})/g)) {
        const label = m[1].trim().replace(/:$/, "");
        const value = decode(m[2].trim());
        if (label && value) dates.push({ label, value });
      }
    }

    // Submission status table rows
    const rows: AssignRow[] = [];
    const tableIdx = html.indexOf('class="submissionstatustable"');
    if (tableIdx !== -1) {
      const chunk = html.slice(tableIdx, tableIdx + 5000);
      for (const m of chunk.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
        if (cells.length >= 2) {
          const label = decode(stripTags(cells[0][1])).trim();
          const value = decode(stripTags(cells[1][1])).trim();
          if (label && value) rows.push({ label, value });
        }
      }
    }

    // Description (intro div) — only if non-empty
    const descIdx = html.indexOf('id="intro"');
    let description = "";
    if (descIdx !== -1) {
      const descChunk = html.slice(descIdx, descIdx + 2000);
      const inner = descChunk.match(/>([\s\S]*?)<\/div>/)?.[1] ?? "";
      description = decode(stripTags(inner)).trim();
    }

    return NextResponse.json({ title, dates, rows, description } satisfies AssignInfo);
  } catch (err) {
    console.error("[assign]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
