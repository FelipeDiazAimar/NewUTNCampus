import { absMoodleUrl } from "@/lib/moodle";
import { encodeUrlRef } from "@/lib/urlToken";

/**
 * Parser del árbol de archivos de un módulo `mod_folder` de Moodle
 * (`.filemanager` / `fp-filename-icon`). Se usa desde dos lugares:
 *  - app/api/folder/route.ts: carpetas con "Mostrar en página separada"
 *    (fetch a mod/folder/view.php?id=…).
 *  - app/api/course/route.ts: carpetas con "Mostrar en la página del curso"
 *    (el árbol ya viene embebido en el HTML de la sección — Moodle redirige
 *    view.php de vuelta al curso para este modo, así que no sirve pedirlo aparte).
 */

export type FolderTreeNode =
  | { type: "file"; name: string; url: string; fileType?: string }
  | { type: "folder"; name: string; children: FolderTreeNode[] };

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

// Moodle's filemanager uses icon URLs like /f/archive, /f/pdf, /f/document …
const ICON_TYPE_MAP: Record<string, string> = {
  pdf: "PDF", document: "DOCX", spreadsheet: "XLSX", powerpoint: "PPTX",
  archive: "ZIP", text: "TXT", image: "IMG", audio: "MP3", video: "MP4",
  sourcecode: "CODE", unknown: "FILE", folder: "DIR",
};

function iconTypeFromImg(html: string): string | undefined {
  const raw =
    html.match(/\/f\/([a-z0-9_-]+?)(?:-\d+)?(?:["'?]|\s)/i)?.[1]?.toLowerCase() ??
    html.match(/\/f\/([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
  if (!raw) return undefined;
  return ICON_TYPE_MAP[raw] ?? raw.toUpperCase().slice(0, 4);
}

/** Slice the inner HTML of a balanced <tag>…</tag> starting at `openIdx`. */
function sliceBalanced(html: string, openIdx: number, tag: string): { inner: string; end: number } {
  const openEnd = html.indexOf(">", openIdx) + 1;
  const openRe = new RegExp(`<${tag}[\\s>]`, "g");
  const closeStr = `</${tag}>`;
  let depth = 1;
  let i = openEnd;
  while (depth > 0 && i < html.length) {
    openRe.lastIndex = i;
    const o = openRe.exec(html);
    const c = html.indexOf(closeStr, i);
    if (c === -1) break;
    if (o && o.index < c) {
      depth++;
      i = o.index + 1;
    } else {
      depth--;
      if (depth === 0) return { inner: html.slice(openEnd, c), end: c + closeStr.length };
      i = c + closeStr.length;
    }
  }
  return { inner: html.slice(openEnd), end: html.length };
}

/** Parse the children of a <ul> (its inner HTML) into folder nodes. */
function parseList(ulInner: string): FolderTreeNode[] {
  const nodes: FolderTreeNode[] = [];
  let i = 0;
  while (i < ulInner.length) {
    const liStart = ulInner.indexOf("<li", i);
    if (liStart === -1) break;
    const { inner: liInner, end } = sliceBalanced(ulInner, liStart, "li");
    i = end;

    // The entry's own descriptor is the first fp-filename-icon block,
    // which always appears before any nested <ul> of children.
    const nestedUlIdx = liInner.indexOf("<ul");
    const selfHtml = nestedUlIdx === -1 ? liInner : liInner.slice(0, nestedUlIdx);

    const iconBlock = selfHtml.match(/fp-icon[\s\S]*?<\/span>/i)?.[0] ?? selfHtml;
    const fileType = iconTypeFromImg(iconBlock);

    const linkMatch = selfHtml.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const nameFromSpan = stripTags(
      selfHtml.match(/class="[^"]*fp-filename[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""
    );

    if (linkMatch) {
      // A real file: <a href="…pluginfile.php/…?forcedownload=1">name</a>.
      // Drop forcedownload so the proxy can serve it inline for previewing.
      const rawUrl = decodeEntities(linkMatch[1]).replace(/[?&]forcedownload=1\b/g, "");
      const url = encodeUrlRef(absMoodleUrl(rawUrl));
      const name = stripTags(linkMatch[2]) || nameFromSpan || "Archivo";
      nodes.push({ type: "file", name, url, fileType });
    } else if (nestedUlIdx !== -1) {
      // A subfolder: descriptor with no link, followed by a nested <ul>.
      const { inner: childUl } = sliceBalanced(liInner, nestedUlIdx, "ul");
      const children = parseList(childUl);
      // Root wrapper folder has an empty name — flatten it away.
      if (!nameFromSpan) {
        nodes.push(...children);
      } else {
        nodes.push({ type: "folder", name: nameFromSpan, children });
      }
    } else if (nameFromSpan) {
      // Empty folder with a name but no children.
      nodes.push({ type: "folder", name: nameFromSpan, children: [] });
    }
  }
  return nodes;
}

/** Busca el primer `.filemanager` dentro de `html` y devuelve su árbol de nodos. */
export function parseFolderTree(html: string): FolderTreeNode[] {
  const fmIdx = html.search(/class="[^"]*\bfilemanager\b[^"]*"/);
  if (fmIdx === -1) return [];
  const divStart = html.lastIndexOf("<div", fmIdx);
  if (divStart === -1) return [];
  const { inner } = sliceBalanced(html, divStart, "div");
  const firstUl = inner.indexOf("<ul");
  if (firstUl === -1) return [];
  const { inner: rootUl } = sliceBalanced(inner, firstUl, "ul");
  return parseList(rootUl);
}
