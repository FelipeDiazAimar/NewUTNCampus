// Corre como "postbuild" (ver package.json), justo después de `next build`,
// cuando .next/static/ todavía existe en el filesystem del build. En Vercel
// esa carpeta NO está disponible dentro de una función serverless en
// producción (el bundle de la función se recorta y esos assets se sirven
// directo desde el CDN) — por eso la lista se genera una sola vez acá y se
// escribe como un archivo estático en public/, en vez de calcularla en cada
// request desde una API route (lo que devolvía 0 archivos en producción).
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const staticDir = path.join(process.cwd(), ".next", "static");
const urls = [];

function walk(dir, prefix) {
  let entries;
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

const outPath = path.join(process.cwd(), "public", "precache-manifest.json");
writeFileSync(outPath, JSON.stringify({ urls }));
console.log(`[precache-manifest] wrote ${urls.length} files to public/precache-manifest.json`);
