import { NextRequest, NextResponse } from "next/server";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

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

type FolderNode =
  | { type: "file"; name: string; url: string; fileType?: string }
  | { type: "folder"; name: string; children: FolderNode[] };

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
function parseList(ulInner: string): FolderNode[] {
  const nodes: FolderNode[] = [];
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
      const url = decodeEntities(linkMatch[1]).replace(/[?&]forcedownload=1\b/g, "");
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

function parseFolderPage(html: string): {
  name: string;
  intro?: string;
  entries: FolderNode[];
} {
  // Scope to the main content region so the sidebar ("Bloques" heading, block
  // navigation lists) never leak into the title or file tree.
  const mainIdx = html.indexOf('id="region-main"');
  const scope = mainIdx !== -1 ? html.slice(mainIdx) : html;

  const name =
    decodeEntities(scope.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "").trim() || "Carpeta";

  const introRaw =
    scope.match(/id="intro"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ??
    scope.match(/class="[^"]*activity-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
    "";
  const intro = stripTags(introRaw) || undefined;

  // Scope strictly to the filemanager tree so navigation/sidebar lists never leak in.
  const fmIdx = scope.search(/class="[^"]*\bfilemanager\b[^"]*"/);
  let entries: FolderNode[] = [];
  if (fmIdx !== -1) {
    const divStart = scope.lastIndexOf("<div", fmIdx);
    const { inner } = sliceBalanced(scope, divStart, "div");
    const firstUl = inner.indexOf("<ul");
    if (firstUl !== -1) {
      const { inner: rootUl } = sliceBalanced(inner, firstUl, "ul");
      entries = parseList(rootUl);
    }
  }

  return { name, intro, entries };
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const id = req.nextUrl.searchParams.get("id");

  if (!sessionToken || !id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  const cookie = `MoodleSession=${sessionToken}`;

  try {
    const res = await fetch(`${MOODLE_BASE}/mod/folder/view.php?id=${id}`, {
      headers: { Cookie: cookie },
    });
    if (res.url.includes("/login/")) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const html = await res.text();
    const parsed = parseFolderPage(html);

    return NextResponse.json({
      data: {
        ...parsed,
        downloadUrl: `${MOODLE_BASE}/mod/folder/download_folder.php?id=${id}`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
