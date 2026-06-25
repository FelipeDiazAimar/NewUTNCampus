import { NextRequest, NextResponse } from "next/server";
import type { MoodleCourseSection, MoodleModule, MoodleContent } from "@/lib/moodle";
import { isGuestRequest } from "@/lib/guest";
import { MOCK_COURSE_SECTIONS } from "@/lib/guestMockData";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string) {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

// ─── Module parser ────────────────────────────────────────────────────────────
// Works on any HTML chunk that contains id="module-N" elements.

function parseModules(html: string): MoodleModule[] {
  const modules: MoodleModule[] = [];
  const positions = [...html.matchAll(/id="module-(\d+)"/g)];

  // Each module's `modtype_X` class lives on the opening <li>, which sits *before*
  // its id="module-N". Start each chunk at that <li> so the type is always inside
  // the chunk — otherwise header labels (which have no inner modtype_) get
  // misclassified as the following activity's type.
  const starts = positions.map((p) => {
    const li = html.lastIndexOf("<li", p.index!);
    return li !== -1 && p.index! - li < 600 ? li : p.index!;
  });

  for (let i = 0; i < positions.length; i++) {
    const modId = parseInt(positions[i][1]);
    const start = starts[i];
    const end = starts[i + 1] ?? html.length;
    const chunk = html.slice(start, end);

    const modname = chunk.match(/\bmodtype_(\w+)\b/)?.[1]?.toLowerCase() ?? "resource";

    // data-activityname is the cleanest source (set by Moodle's core renderer)
    const nameRaw =
      chunk.match(/data-activityname="([^"]+)"/)?.[1] ??
      stripTags(chunk.match(/class="[^"]*instancename[^"]*">([\s\S]*?)<\/span>/)?.[1] ?? "");
    const name = decodeEntities(nameRaw || `Módulo ${modId}`);

    const url =
      chunk.match(/class="[^"]*aalink[^"]*"[^>]*href="([^"]+)"/)?.[1] ??
      chunk.match(/<a[^>]+href="([^"]*\/mod\/[^"]+)"/)?.[1];

    const visible =
      chunk.includes("dimmed_text") || chunk.includes('"dimmed"') ? 0 : 1;

    if (modname === "label") {
      const labelHtml =
        chunk.match(/class="[^"]*no-overflow[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ??
        chunk.match(/class="[^"]*contentwithoutlink[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
      modules.push({
        id: modId,
        name: stripTags(labelHtml) || name,
        modname: "label",
        modicon: "",
        visible,
        description: labelHtml.trim() || undefined,
      });
      continue;
    }

    const mod: MoodleModule = { id: modId, name, modname, modicon: "", url, visible };

    if (url && (modname === "resource" || modname === "folder" || modname === "url")) {
      // Extract file type from Moodle icon URL (/f/pdf-24) or Font Awesome class
      const iconType =
        chunk.match(/\/f\/(pdf|powerpoint|document|spreadsheet|archive|text|image|video|audio)(?:-\d+)?/i)?.[1]?.toLowerCase() ??
        chunk.match(/fa-file-(pdf|word|excel|powerpoint|archive|image|video|audio)/i)?.[1]?.toLowerCase();

      const FILE_TYPE_MAP: Record<string, string> = {
        pdf: "PDF", powerpoint: "PPTX", document: "DOCX", spreadsheet: "XLSX",
        archive: "ZIP", text: "TXT", image: "IMG", video: "MP4", audio: "MP3",
        word: "DOCX", excel: "XLSX",
      };

      const content: MoodleContent = {
        type: modname === "url" ? "url" : "file",
        filename: name,
        filesize: 0,
        fileurl: url,
        timemodified: 0,
        fileType: iconType ? (FILE_TYPE_MAP[iconType] ?? iconType.toUpperCase().slice(0, 4)) : undefined,
      };
      mod.contents = [content];
    }

    modules.push(mod);
  }

  return modules;
}

// ─── Section list parser ─────────────────────────────────────────────────────
// Uses data-sectionid, data-id, data-sectionname attributes (reliable across themes).

type SectionMeta = {
  sectionNum: number; // position (0, 1, 2 …)
  dbId: string;       // Moodle DB id → used in section.php?id=DBID
  name: string;
  isSummary: boolean; // true = collapsed on main page, needs a separate fetch
  htmlStart: number;  // index in main HTML where this section starts
  htmlEnd: number;    // index where it ends
};

function sanitizeSummaryHtml(html: string): string {
  return html
    // Remove dangerous elements
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[^>]*>/gi, "")
    // Remove event handlers
    .replace(/\s+on\w+="[^"]*"/gi, "")
    .replace(/\s+on\w+='[^']*'/gi, "")
    .replace(/href="javascript:[^"]*"/gi, 'href="#"')
    // Strip inline styles and Moodle classes so they never override the app's typography
    .replace(/\s+style="[^"]*"/gi, "")
    .replace(/\s+class="[^"]*"/gi, "")
    // Make Moodle-relative URLs absolute so images and links resolve correctly
    .replace(/\b(href|src)="\/(?!\/)/g, `$1="${MOODLE_BASE}/`)
    // Remove empty paragraphs and stacked <br> left by Moodle's editor
    .replace(/<p>\s*(<br\s*\/?>)?\s*<\/p>/gi, "")
    .replace(/(<br\s*\/?>\s*){2,}/gi, "<br>")
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

/** Extract the section summary HTML from a Moodle section chunk.
 *  Requires the content to be inside a known Moodle summary container so
 *  sidebar / navigation divs (which also use no-overflow) are never matched. */
function extractSummaryHtml(sectionHtml: string): string {
  // Only look before the first module to avoid false positives inside content.
  const firstModuleIdx = sectionHtml.search(/\bid="module-\d+"/);
  const searchArea = firstModuleIdx > 0
    ? sectionHtml.slice(0, firstModuleIdx)
    : sectionHtml.slice(0, 12000);

  // Known containers for section description text across all Moodle themes.
  // Order matters — most specific first.
  const CONTAINERS: RegExp[] = [
    /class="[^"]*\bsummarytext\b[^"]*"/,
    /class="[^"]*\bsection-description\b[^"]*"/,
    /class="[^"]*\bsectiondescription\b[^"]*"/,
    /class="[^"]*\bdescription-inner\b[^"]*"/,
    // "summary" as a whole word — but must NOT be part of "section-summary"
    /class="([^"]*\bsummary\b[^"]*)"/,
  ];

  for (const pat of CONTAINERS) {
    const m = searchArea.match(pat);
    if (!m || m.index === undefined) continue;

    // For the generic "summary" pattern, skip if it is "section-summary"
    if (pat.source.includes("summary") && m[0].includes("section-summary")) continue;

    // Advance past the opening tag of this container
    const tagEnd = searchArea.indexOf(">", m.index) + 1;
    if (tagEnd <= 0) continue;
    const inner = searchArea.slice(tagEnd, tagEnd + 4000);

    // If the container has a no-overflow child, use that; otherwise use the container directly.
    const noOverflowM = inner.match(/class="[^"]*\bno-overflow\b[^"]*"[^>]*>/);
    const contentSrc = noOverflowM
      ? inner.slice(noOverflowM.index! + noOverflowM[0].length)
      : inner;

    const content = sanitizeSummaryHtml(extractUntilClosingDiv(contentSrc).trim());
    if (content) return content;
  }

  return "";
}

function parseSectionMeta(mainHtml: string): SectionMeta[] {
  const positions = [...mainHtml.matchAll(/id="section-(\d+)"/g)];
  return positions.map((match, i) => {
    const sectionNum = parseInt(match[1]);
    const htmlStart = match.index!;
    const htmlEnd = positions[i + 1]?.index ?? mainHtml.length;
    // Read data-* attrs from the next ~600 chars (the <li> opening tag)
    const tag = mainHtml.slice(htmlStart, htmlStart + 600);

    const dbId = tag.match(/\bdata-id="(\d+)"/)?.[1] ?? "";
    const name = decodeEntities(tag.match(/\bdata-sectionname="([^"]+)"/)?.[1] ?? `Sección ${sectionNum}`);
    const isSummary = tag.includes("section-summary");

    return { sectionNum, dbId, name, isSummary, htmlStart, htmlEnd };
  });
}

// ─── Filename resolver ────────────────────────────────────────────────────────
// Follows view.php redirects server-side (HEAD only — no body download) to get
// the real filename from Content-Disposition or the final URL path.

async function resolveFilename(viewUrl: string, cookie: string): Promise<string | null> {
  let current = viewUrl;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(current, {
        method: "HEAD",
        headers: { Cookie: cookie },
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        current = loc.startsWith("http") ? loc : `${MOODLE_BASE}${loc}`;
        continue;
      }
      const disp = res.headers.get("content-disposition") ?? "";
      const fromDisp = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i)?.[1];
      if (fromDisp) return decodeURIComponent(fromDisp);
      const last = decodeURIComponent(current.split("/").pop()?.split("?")[0] ?? "");
      if (last && last.includes(".") && !last.endsWith(".php")) return last;
      break;
    } catch { break; }
  }
  return null;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (isGuestRequest(req)) {
    const courseId = Number(req.nextUrl.searchParams.get("id"));
    const mock = MOCK_COURSE_SECTIONS[courseId];
    if (!mock) return NextResponse.json({ data: [], courseName: "Materia" });
    return NextResponse.json({ data: mock.data, courseName: mock.courseName });
  }

  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const courseId = req.nextUrl.searchParams.get("id");

  if (!sessionToken || !courseId) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const cookie = `MoodleSession=${sessionToken}`;

  try {
    // 1. Fetch main course page
    const mainRes = await fetch(`${MOODLE_BASE}/course/view.php?id=${courseId}`, {
      headers: { Cookie: cookie },
    });
    if (mainRes.url.includes("/login/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const mainHtml = await mainRes.text();
    console.log("[course] main page length:", mainHtml.length, "url:", mainRes.url);

    const rawTitle = mainHtml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
    const courseName = rawTitle.split(/\s*[|–—]\s*/)[0].trim().replace(/^curso:\s*/i, "");

    const metas = parseSectionMeta(mainHtml);
    console.log("[course] sections found:", metas.map((m) => `${m.sectionNum}:"${m.name}"${m.isSummary ? "(summary)" : ""}`).join(", "));

    // 2. For each section, get modules.
    //    • Section with full content (not isSummary): slice main HTML
    //    • Section with only summary: fetch course/section.php?id=DBID in parallel
    const sections: MoodleCourseSection[] = await Promise.all(
      metas.map(async (meta) => {
        let modules: MoodleModule[];

        let sectionHtml: string;
        if (!meta.isSummary) {
          sectionHtml = mainHtml.slice(meta.htmlStart, meta.htmlEnd);
          modules = parseModules(sectionHtml);
        } else if (meta.dbId) {
          const sRes = await fetch(`${MOODLE_BASE}/course/section.php?id=${meta.dbId}`, {
            headers: { Cookie: cookie },
          });
          sectionHtml = await sRes.text();
          modules = parseModules(sectionHtml);
        } else {
          sectionHtml = "";
          modules = [];
        }

        const summaryHtml = extractSummaryHtml(sectionHtml);
        console.log(`[course] section ${meta.sectionNum} "${meta.name}": ${modules.length} modules, summaryHtml: ${summaryHtml.length} chars`);
        modules.forEach((m) => {
          console.log(
            `  [mod] id=${m.id} modname=${JSON.stringify(m.modname)} name=${JSON.stringify(m.name)} ` +
            `visible=${m.visible} url=${JSON.stringify(m.url ?? "")} ` +
            `descLen=${m.description?.length ?? 0}`
          );
        });
        return {
          id: meta.sectionNum,
          name: meta.name,
          visible: 1,
          summaryHtml,
          modules,
        };
      })
    );

    // Resolve real filenames for view.php resources in parallel (HEAD only, no download)
    const resolveJobs: Promise<void>[] = [];
    for (const section of sections) {
      for (const mod of section.modules) {
        for (const content of mod.contents ?? []) {
          if (content.fileurl?.includes("view.php")) {
            resolveJobs.push(
              resolveFilename(content.fileurl, cookie).then((name) => {
                if (name) content.filename = name;
              })
            );
          }
        }
      }
    }
    await Promise.all(resolveJobs);

    return NextResponse.json({ data: sections, courseName });
  } catch (err) {
    console.error("[course] error:", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
