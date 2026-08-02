import { NextRequest, NextResponse } from "next/server";

import { MOODLE_BASE } from "@/lib/moodle";
import { encodeUrlRef } from "@/lib/urlToken";
import { parseFolderTree, type FolderTreeNode } from "@/lib/folderTree";

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

function parseFolderPage(html: string): {
  name: string;
  intro?: string;
  entries: FolderTreeNode[];
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

  const entries = parseFolderTree(scope);

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
        downloadUrl: encodeUrlRef(`${MOODLE_BASE}/mod/folder/download_folder.php?id=${id}`),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
