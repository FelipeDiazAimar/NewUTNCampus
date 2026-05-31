import { NextRequest, NextResponse } from "next/server";
import type { MoodleCourseSection, MoodleModule, MoodleContent } from "@/lib/moodle";

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

  for (let i = 0; i < positions.length; i++) {
    const modId = parseInt(positions[i][1]);
    const start = positions[i].index!;
    const end = positions[i + 1]?.index ?? html.length;
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

function extractSectionSummary(sectionHtml: string): string {
  // Moodle renders section summaries in a div.summary > div.no-overflow
  const summaryBlock =
    sectionHtml.match(/class="[^"]*\bsummary\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ??
    sectionHtml.match(/class="[^"]*section_description[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";

  // Strip the inner no-overflow wrapper if present
  const inner = summaryBlock.match(/class="[^"]*no-overflow[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? summaryBlock;
  const text = stripTags(inner).replace(/\s+/g, " ").trim();
  return text;
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

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
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
    const courseName = rawTitle.split(/\s*[|–—]\s*/)[0].trim();

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

        const summary = extractSectionSummary(sectionHtml);
        console.log(`[course] section ${meta.sectionNum} "${meta.name}": ${modules.length} modules, summary: ${summary.length} chars`);
        return {
          id: meta.sectionNum,
          name: meta.name,
          visible: 1,
          summary,
          modules,
        };
      })
    );

    return NextResponse.json({ data: sections, courseName });
  } catch (err) {
    console.error("[course] error:", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
