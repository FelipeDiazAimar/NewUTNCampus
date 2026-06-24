import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { google, drive_v3 } from "googleapis";
import { Readable } from "stream";

export const maxDuration = 60;

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

// ── Google Drive PDF conversion ─────────────────────────────────────────────

const SUPPORTED_EXTS = new Set(["xlsx", "pptx"]);

const SOURCE_MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const GOOGLE_MIME: Record<string, string> = {
  xlsx: "application/vnd.google-apps.spreadsheet",
  pptx: "application/vnd.google-apps.presentation",
};

export async function POST(req: NextRequest) {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const envRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const folderId     = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!clientId || !clientSecret)
    return NextResponse.json({ error: "Google OAuth credentials not configured" }, { status: 500 });

  // Cookie-stored token (from re-auth flow) takes precedence over env var
  const refreshToken =
    req.cookies.get("google_refresh_token")?.value ?? envRefreshToken ?? "";

  if (!refreshToken)
    return NextResponse.json(
      { error: "Google Drive no está conectado", code: "GOOGLE_AUTH_REQUIRED" },
      { status: 401 }
    );

  const sessionToken = req.cookies.get("moodle_session_token")?.value;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "FormData inválido" }, { status: 400 });
  }

  // Accept either a URL (server fetches the file) or a raw File blob
  const urlField = formData.get("url");
  const kindField = (formData.get("kind") as string | null)?.toLowerCase() ?? "";
  let fileBuffer: Buffer;
  let ext: string;
  let outputFilename: string;

  if (typeof urlField === "string" && urlField) {
    if (!sessionToken)
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    ext = kindField || urlField.split(".").pop()?.toLowerCase() || "";
    outputFilename = `archivo.${ext.replace(/\.[^.]+$/, "")}.pdf`;
    const moodleRes = await fetchWithCookie(urlField, `MoodleSession=${sessionToken}`);
    if (!moodleRes.ok)
      return NextResponse.json({ error: `Error al descargar el archivo (HTTP ${moodleRes.status})` }, { status: 502 });
    fileBuffer = Buffer.from(await moodleRes.arrayBuffer());
  } else {
    const file = formData.get("file");
    if (!(file instanceof File))
      return NextResponse.json({ error: "Campo 'url' o 'file' requerido" }, { status: 400 });
    ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    outputFilename = file.name.replace(/\.[^.]+$/, ".pdf");
    fileBuffer = Buffer.from(await file.arrayBuffer());
  }

  if (!SUPPORTED_EXTS.has(ext))
    return NextResponse.json(
      { error: `Formato .${ext} no soportado. Use .xlsx o .pptx.` },
      { status: 400 }
    );

  let fileId: string | null = null;
  let drive: drive_v3.Drive | null = null;

  try {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    drive = google.drive({ version: "v3", auth: oauth2 });

    const uploadRes = await drive.files.create({
      requestBody: {
        name: `campus-convert-${Date.now()}.${ext}`,
        mimeType: GOOGLE_MIME[ext],
        ...(folderId ? { parents: [folderId] } : {}),
      },
      media: {
        mimeType: SOURCE_MIME[ext],
        body: Readable.from(fileBuffer),
      },
      fields: "id",
    });

    fileId = uploadRes.data.id ?? null;
    if (!fileId) throw new Error("Drive no retornó un ID de archivo tras la subida");

    const exportRes = await drive.files.export(
      { fileId, mimeType: "application/pdf" },
      { responseType: "arraybuffer" }
    );

    const pdfBuffer = Buffer.from(exportRes.data as unknown as ArrayBuffer);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${outputFilename}"`,
        "Content-Length": String(pdfBuffer.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    console.error("[convert/pdf]", message);
    const isAuthError = message.includes("invalid_grant") || message.includes("invalid_client");
    return NextResponse.json(
      { error: message, ...(isAuthError ? { code: "GOOGLE_AUTH_REQUIRED" } : {}) },
      { status: isAuthError ? 401 : 500 }
    );
  } finally {
    if (fileId && drive) {
      await drive.files
        .delete({ fileId })
        .catch((e) => console.error(`[convert/pdf] delete ${fileId}:`, e.message));
    }
  }
}

// ── Moodle file conversion (HTML/slides/table) ───────────────────────────────

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const url = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") ?? "archivo";
  // `type` overrides extension-based detection (useful when filename has no extension)
  const typeHint = req.nextUrl.searchParams.get("type")?.toLowerCase() ?? "";

  if (!sessionToken || !url) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  // Build a synthetic filename from the type hint so convertBuffer picks the right branch
  const effectiveFilename = typeHint
    ? `file.${typeHint}`
    : filename;

  try {
    const res = await fetchWithCookie(url, `MoodleSession=${sessionToken}`);
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());

    console.log("[convert]", effectiveFilename, contentType, buf.length, "bytes");
    const result = await convertBuffer(buf, effectiveFilename, contentType);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[convert] error:", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
