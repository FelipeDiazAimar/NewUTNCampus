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
  const clientId        = process.env.GOOGLE_CLIENT_ID;
  const clientSecret    = process.env.GOOGLE_CLIENT_SECRET;
  const envRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const folderId        = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!clientId || !clientSecret)
    return NextResponse.json({ error: "Google OAuth credentials not configured" }, { status: 500 });

  const refreshToken = req.cookies.get("google_refresh_token")?.value ?? envRefreshToken ?? "";
  if (!refreshToken)
    return NextResponse.json(
      { error: "Google Drive no está conectado", code: "GOOGLE_AUTH_REQUIRED" },
      { status: 401 }
    );

  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  if (!sessionToken)
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: "FormData inválido" }, { status: 400 }); }

  const urlField  = formData.get("url");
  const kindField = (formData.get("kind") as string | null)?.toLowerCase() ?? "";

  if (typeof urlField !== "string" || !urlField)
    return NextResponse.json({ error: "Campo 'url' requerido" }, { status: 400 });

  const ext = kindField || urlField.split(".").pop()?.toLowerCase() || "";
  if (!SUPPORTED_EXTS.has(ext))
    return NextResponse.json({ error: `Formato .${ext} no soportado.` }, { status: 400 });

  // ── SSE stream ──────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { /* stream closed by client */ }
      };

      let fileId: string | null = null;
      let drive: drive_v3.Drive | null = null;

      try {
        // ── Step 1: Download from Moodle (2 → 30%) ────────────────────────
        send({ progress: 2, label: "Preparando archivo…" });

        const moodleRes = await fetchWithCookie(urlField, `MoodleSession=${sessionToken}`);
        if (!moodleRes.ok) {
          send({ error: `Error al descargar el archivo (HTTP ${moodleRes.status})` });
          return;
        }

        const contentLength = parseInt(moodleRes.headers.get("content-length") ?? "0");
        const chunks: Buffer[] = [];
        let downloaded = 0;

        if (moodleRes.body) {
          const reader = moodleRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Buffer.from(value));
            downloaded += value.length;
            if (contentLength > 0) {
              send({
                progress: 2 + Math.min(28, Math.round((downloaded / contentLength) * 28)),
                label: "Preparando archivo…",
              });
            }
          }
        } else {
          chunks.push(Buffer.from(await moodleRes.arrayBuffer()));
        }

        const fileBuffer = Buffer.concat(chunks);
        send({ progress: 30, label: "Procesando…" });

        // ── Step 2: Upload to Drive (30 → 65%) ────────────────────────────
        const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
        oauth2.setCredentials({ refresh_token: refreshToken });
        drive = google.drive({ version: "v3", auth: oauth2 });

        const uploadRes = await drive.files.create(
          {
            requestBody: {
              name: `campus-convert-${Date.now()}.${ext}`,
              mimeType: GOOGLE_MIME[ext],
              ...(folderId ? { parents: [folderId] } : {}),
            },
            media: { mimeType: SOURCE_MIME[ext], body: Readable.from(fileBuffer) },
            fields: "id",
          },
          {
            onUploadProgress: (evt: { bytesRead: number }) => {
              send({
                progress: 30 + Math.min(33, Math.round((evt.bytesRead / fileBuffer.length) * 33)),
                label: "Procesando…",
              });
            },
          }
        );

        fileId = uploadRes.data.id ?? null;
        if (!fileId) throw new Error("Drive no retornó un ID de archivo tras la subida");

        // ── Step 3: Export PDF (65 → 80%) ─────────────────────────────────
        send({ progress: 65, label: "Generando vista previa…" });

        const exportRes = await drive.files.export(
          { fileId, mimeType: "application/pdf" },
          { responseType: "arraybuffer" }
        );

        send({ progress: 80, label: "Casi listo…" });

        const pdfBuffer = Buffer.from(exportRes.data as unknown as ArrayBuffer);

        // ── Done: send PDF as base64 (100%) ───────────────────────────────
        send({ progress: 100, label: "Abriendo…", pdf: pdfBuffer.toString("base64") });

      } catch (err) {
        const message = err instanceof Error ? err.message : "Error interno";
        console.error("[convert/pdf]", message);
        const isAuthError = message.includes("invalid_grant") || message.includes("invalid_client");
        send({ error: message, ...(isAuthError ? { code: "GOOGLE_AUTH_REQUIRED" } : {}) });
      } finally {
        if (fileId && drive) {
          await drive.files
            .delete({ fileId })
            .catch((e) => console.error(`[convert/pdf] delete ${fileId}:`, e.message));
        }
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
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
