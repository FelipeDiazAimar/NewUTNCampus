import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

async function fetchWithCookie(url: string, cookie: string, maxRedirects = 5): Promise<Response> {
  let current = url;
  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetch(current, { headers: { Cookie: cookie }, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = loc.startsWith("http") ? loc : `${MOODLE_BASE}${loc}`;
      continue;
    }
    return res;
  }
  throw new Error("Demasiados redirects");
}

export interface Slide {
  index: number;
  paragraphs: string[];
}

export type ConvertResult =
  | { kind: "html"; html: string }
  | { kind: "table"; html: string; sheetNames: string[] }
  | { kind: "slides"; slides: Slide[] }
  | { kind: "text"; text: string };

async function convertBuffer(buf: Buffer, filename: string, contentType: string): Promise<ConvertResult> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  // ── DOCX ────────────────────────────────────────────────────────────────────
  if (ext === "docx" || contentType.includes("wordprocessingml") || contentType.includes("msword")) {
    const result = await mammoth.convertToHtml({ buffer: buf });
    return { kind: "html", html: result.value };
  }

  // ── XLSX / XLS / CSV ────────────────────────────────────────────────────────
  if (
    ["xlsx", "xls", "csv"].includes(ext) ||
    contentType.includes("spreadsheetml") ||
    contentType.includes("ms-excel") ||
    contentType.includes("text/csv")
  ) {
    const workbook = XLSX.read(buf);
    const htmlParts = workbook.SheetNames.map((name) =>
      XLSX.utils.sheet_to_html(workbook.Sheets[name], { id: `sheet-${name}` })
    );
    return { kind: "table", html: htmlParts.join(""), sheetNames: workbook.SheetNames };
  }

  // ── PPTX ────────────────────────────────────────────────────────────────────
  if (ext === "pptx" || contentType.includes("presentationml")) {
    const zip = await JSZip.loadAsync(buf);
    const slideKeys = Object.keys(zip.files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => {
        const n = (s: string) => parseInt(s.match(/\d+/)?.[0] ?? "0");
        return n(a) - n(b);
      });

    const slides: Slide[] = await Promise.all(
      slideKeys.map(async (key, i) => {
        const xml = await zip.files[key].async("text");
        // Group text runs by their parent paragraph
        const paragraphs: string[] = [];
        for (const pm of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
          const line = [...pm[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
            .map((m) => m[1])
            .join("")
            .trim();
          if (line) paragraphs.push(line);
        }
        return { index: i + 1, paragraphs };
      })
    );

    return { kind: "slides", slides };
  }

  // ── Plain text / HTML / Markdown ────────────────────────────────────────────
  return { kind: "text", text: buf.toString("utf-8") };
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const url = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") ?? "archivo";

  if (!sessionToken || !url) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  try {
    const res = await fetchWithCookie(url, `MoodleSession=${sessionToken}`);
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());

    console.log("[convert]", filename, contentType, buf.length, "bytes");
    const result = await convertBuffer(buf, filename, contentType);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[convert] error:", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
