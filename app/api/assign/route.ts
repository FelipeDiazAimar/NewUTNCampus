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
  files: SubmittedFile[];        // archivos que entregó el alumno
  introFiles: SubmittedFile[];   // adjuntos de la consigna (los sube el profesor)
  comments: AssignComments | null;
}

/**
 * Extrae los bloques `fileuploadsubmission`. ¡Ojo!: Moodle usa esta misma clase
 * tanto para los adjuntos de la consigna (introattachment, los sube el profesor)
 * como para los archivos que entrega el alumno (submission_files). Se distinguen
 * por la URL del pluginfile — la clasificación se hace en el caller.
 */
function parseFileBlocks(html: string): SubmittedFile[] {
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

    // Submission status table rows. Moodle pone la etiqueta en un <th scope="row">
    // y el valor en un <td>, así que hay que capturar ambos tipos de celda.
    const rows: AssignRow[] = [];
    const tableIdx = html.indexOf('class="submissionstatustable"');
    if (tableIdx !== -1) {
      const chunk = html.slice(tableIdx, tableIdx + 6000);
      for (const m of chunk.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const cells = [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)];
        if (cells.length >= 2) {
          const label = decode(stripTags(cells[0][1])).trim();
          const value = decode(stripTags(cells[1][1])).trim();
          if (label && value) rows.push({ label, value });
        }
      }
    }

    // Bloque de la consigna (activity-description). Arrancamos DESPUÉS del ">" de
    // la etiqueta de apertura, si no el texto del atributo (id="intro">) se cuela
    // como contenido de la descripción.
    const descIdx = html.indexOf('id="intro"');
    let description = "";
    if (descIdx !== -1) {
      const tagEnd = html.indexOf(">", descIdx);
      const body = tagEnd !== -1 ? html.slice(tagEnd + 1) : html.slice(descIdx);
      // La consigna termina donde abre el <div role="main"> (estado de la entrega).
      // Cortamos en el "<" de esa etiqueta para no dejar un "<div" sin cerrar.
      const mainAttr = body.indexOf('role="main"');
      const inner = mainAttr !== -1 ? body.slice(0, body.lastIndexOf("<", mainAttr)) : body.slice(0, 3000);
      // Quitamos el árbol de adjuntos — esos se muestran aparte como introFiles.
      const noTree = inner.replace(/<div[^>]*id="assign_files_tree[^"]*"[\s\S]*?<\/ul>\s*<\/div>/gi, " ");
      description = decode(stripTags(noTree)).trim();
    }

    // Archivos: separamos los adjuntos de la consigna (introattachment) de los
    // archivos realmente entregados por el alumno (submission_files).
    const allBlocks = parseFileBlocks(html);
    const isIntro = (f: SubmittedFile) => /introattachment/i.test(f.url);
    const introFiles = allBlocks.filter(isIntro);
    const files = allBlocks.filter((f) => !isIntro(f));

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

    // "Entregado" SOLO si hay archivos de entrega reales, o el estado dice
    // explícitamente "Enviado para calificar" (clase submissionstatussubmitted).
    // Nunca por "No se ha enviado nada…" (que también contiene "enviado").
    const submitted =
      files.length > 0 ||
      /submissionstatussubmitted/i.test(html) ||
      rows.some((r) => /estado de (la )?entrega/i.test(r.label) && /enviado para calificar/i.test(r.value));

    return NextResponse.json({
      title, dates, rows, description, cmid, submitted, files, introFiles, comments,
    } satisfies AssignInfo);
  } catch (err) {
    console.error("[assign]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
