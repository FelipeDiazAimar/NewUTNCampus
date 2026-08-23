import { NextResponse } from "next/server";
import { readdirSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

/**
 * Lista TODOS los archivos que Next.js generó en .next/static/ (chunks JS,
 * CSS, fuentes internas, etc.) para que el Service Worker los precachee al
 * instalarse — en vez de depender de que se pidan de a uno mientras el
 * usuario navega, lo que deja afuera cualquier chunk que se carga de forma
 * perezosa (code-splitting) y que nunca llegó a dispararse durante la
 * sesión online, aunque la página en sí sí se haya visitado (visto con
 * Turbopack en este proyecto: "Failed to load chunk ... from module").
 *
 * No se lee el manifest interno de Turbopack (formato propio, puede cambiar
 * entre versiones) — se listan los archivos directamente del filesystem,
 * que en Vercel están disponibles junto al resto del build de la función.
 */
export async function GET() {
  const staticDir = path.join(process.cwd(), ".next", "static");
  const urls: string[] = [];

  function walk(dir: string, prefix: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else {
        urls.push(`/_next/static${rel}`);
      }
    }
  }

  walk(staticDir, "");

  return NextResponse.json({ urls });
}
