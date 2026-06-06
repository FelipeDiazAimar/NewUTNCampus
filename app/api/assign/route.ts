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
export interface SubmittedFile {
  name: string;
  url: string;
  time: string;
  fileType: string; // "spreadsheet" | "pdf" | "document" | … (del ícono de Moodle)
}
export interface AssignComments {
  itemid: string;
  contextid: string;
  component: string;
  area: string;
  courseid: string;
}
export interface AssignInfo {
  title: string;
  dates: AssignDate[];
  rows: AssignRow[];
  description: string;
  cmid: string;
  submitted: boolean;
  files: SubmittedFile[];
  comments: AssignComments | null;
}

/** Extrae los archivos entregados de la fila "Archivos enviados". */
function parseSubmittedFiles(html: string): SubmittedFile[] {
  const files: SubmittedFile[] = [];
  for (const block of html.matchAll(/<div class="fileuploadsubmission">([\s\S]*?)<\/div>\s*(?:<div class="fileuploadsubmissiontime">([\s\S]*?)<\/div>)?/gi)) {
    const inner = block[1];
    const time = decode(stripTags(block[2] ?? "")).trim();
    const link = inner.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = decode(link[1]);
    const name = decode(stripTags(link[2])).trim();
    const fileType = inner.match(/\/f\/([a-z]+)/i)?.[1]?.toLowerCase() ?? "file";
    if (name) files.push({ name, url, time, fileType });
  }
  return files;
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

    // Archivos entregados + meta de comentarios + ids.
    const files = parseSubmittedFiles(html);

    const cmid = url.match(/[?&]id=(\d+)/)?.[1] ?? "";
    const courseid =
      html.match(/"courseId":(\d+)/)?.[1] ??
      html.match(/[?&]course=(\d+)/)?.[1] ?? "";

    const commentsHref = html.match(/class="showcommentsnonjs"\s+href="([^"]+)"/i)?.[1] ?? "";
    const comments: AssignComments | null = commentsHref
      ? {
          itemid: commentsHref.match(/comment_itemid=(\d+)/)?.[1] ?? "",
          contextid: commentsHref.match(/comment_context=(\d+)/)?.[1] ?? "",
          component: commentsHref.match(/comment_component=([\w]+)/)?.[1] ?? "assignsubmission_comments",
          area: commentsHref.match(/comment_area=([\w]+)/)?.[1] ?? "submission_comments",
          courseid,
        }
      : null;

    const submitted =
      files.length > 0 ||
      rows.some((r) => /estado de (la )?entrega/i.test(r.label) && /enviado/i.test(r.value));

    return NextResponse.json({
      title, dates, rows, description, cmid, submitted, files, comments,
    } satisfies AssignInfo);
  } catch (err) {
    console.error("[assign]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
