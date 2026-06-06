/**
 * Sysacad (UTN) login proxy — scrape-based, mirrors the Moodle approach in
 * `lib/moodle.ts`.  Sysacad is a classic ASP app: the login form posts
 * `legajo` + `password` to `menuAlumno.asp`, and the authenticated state lives
 * in the `ASPSESSIONID*` cookie (no CSRF token).  Responses are iso-8859-1.
 *
 * Each UTN regional runs its own Sysacad server.  We only have San Francisco's
 * endpoint, so other regionals are rejected with a clear message until their
 * base URLs are known.  Add them to FACULTAD_BASE_URLS as they surface.
 */

/** facultad code (see components/SysacadWidget) → Sysacad base URL. */
const FACULTAD_BASE_URLS: Record<number, string> = {
  12: "https://sistemas.frsfco.utn.edu.ar/sysacad", // San Francisco
};

/** Text that Sysacad renders in the page body when credentials are wrong. */
const BAD_CREDENTIALS_MARKER = "Alumno inexistente o password incorrecto";

export interface SysacadMenuLink {
  label: string;
  href: string;
}

export interface SysacadSession {
  /** Raw cookie header value to replay on subsequent requests, e.g. `ASPSESSIONID...=...`. */
  cookie: string;
  /** Resolved base URL for the regional that authenticated. */
  baseUrl: string;
  facultad: number;
  legajo: string;
  /** Student full name scraped from the menu page, when available. */
  alumno: string;
  /** Menu options scraped from the authenticated page (best-effort). */
  menu: SysacadMenuLink[];
}

/** Collect every `ASPSESSIONID*` pair from a Set-Cookie header into one cookie string. */
function extractAspCookies(setCookie: string | null): string {
  if (!setCookie) return "";
  const pairs = [...setCookie.matchAll(/ASPSESSIONID\w+=[^;,\s]+/g)].map((m) => m[0]);
  // De-duplicate by cookie name, keeping the last (freshest) value.
  const byName = new Map<string, string>();
  for (const pair of pairs) {
    const name = pair.split("=")[0];
    byName.set(name, pair);
  }
  return [...byName.values()].join("; ");
}

/** Strip <style>/<script> blocks so markers/links are read from visible body only. */
function stripNonContent(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é").replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó").replace(/&uacute;/gi, "ú").replace(/&ntilde;/gi, "ñ")
    .replace(/&Aacute;/g, "Á").replace(/&Eacute;/g, "É").replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó").replace(/&Uacute;/g, "Ú").replace(/&Ntilde;/g, "Ñ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Best-effort scrape of the student menu links from an authenticated page. */
function parseMenu(body: string, baseUrl: string): SysacadMenuLink[] {
  const links: SysacadMenuLink[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const rawHref = m[1].trim();
    const label = decodeEntities(m[2]);
    if (!rawHref || rawHref === "#" || rawHref === "menuAlumno.asp") continue;
    if (!/\.asp(\?|$)/i.test(rawHref)) continue;
    if (!label) continue;
    const href = rawHref.startsWith("http") ? rawHref : `${baseUrl}/${rawHref.replace(/^\//, "")}`;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({ label, href });
  }
  return links;
}

/** Try to pull the student's name from the authenticated menu page. */
function parseAlumno(body: string): string {
  // Página de menú: el nombre va en <td class="titulo-tabla-menu">Apellido, Nombre</td>.
  const fromMenu = body.match(/titulo-tabla-menu[^>]*>\s*([^<]+?)\s*</i)?.[1];
  if (fromMenu && fromMenu.trim()) return decodeHtmlEntities(fromMenu).trim();
  // Fallbacks por si cambia el markup.
  const text = decodeEntities(body);
  const m =
    text.match(/Bienvenid[oa],?\s+([^()\d]{3,60}?)(?:\s+Legajo|\s*\(|\s+Men[uú])/i) ??
    text.match(/Alumno:?\s+([A-ZÁÉÍÓÚÑ][^()\d]{3,60})/);
  return m ? m[1].trim() : "";
}

export async function sysacadLogin(
  facultad: number,
  legajo: string,
  password: string
): Promise<SysacadSession> {
  const baseUrl = FACULTAD_BASE_URLS[facultad];
  if (!baseUrl) {
    throw new Error(
      "Por ahora solo está disponible la regional San Francisco. Pronto sumaremos las demás."
    );
  }

  // Step 1: GET the login page to obtain a fresh ASP session cookie.
  console.log("[sysacad] Step 1: fetching login page for ASP session...");
  const loginPage = await fetch(`${baseUrl}/loginalumno.asp`, { redirect: "manual" });
  let cookie = extractAspCookies(loginPage.headers.get("set-cookie"));
  console.log("[sysacad] pre-session:", cookie ? "found" : "not found");

  // Step 2: POST credentials to menuAlumno.asp with the session cookie.
  console.log("[sysacad] Step 2: posting credentials...");
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Referer: `${baseUrl}/loginalumno.asp`,
  };
  if (cookie) headers["Cookie"] = cookie;

  const res = await fetch(`${baseUrl}/menuAlumno.asp`, {
    method: "POST",
    headers,
    body: new URLSearchParams({ legajo, password }),
    redirect: "manual",
  });

  // Sysacad regenerates the session on the POST — keep the freshest cookie.
  const postCookie = extractAspCookies(res.headers.get("set-cookie"));
  if (postCookie) cookie = postCookie;

  // iso-8859-1 (latin1) payload — decode accordingly.
  const html = Buffer.from(await res.arrayBuffer()).toString("latin1");
  const body = stripNonContent(html);
  console.log("[sysacad] menu status:", res.status, "len:", html.length);

  if (body.includes(BAD_CREDENTIALS_MARKER)) {
    throw new Error("Legajo o contraseña incorrectos.");
  }

  // A 302 or empty body means the session wasn't authenticated.
  const menu = parseMenu(body, baseUrl);
  if (res.status !== 200 || menu.length === 0) {
    throw new Error("No se pudo iniciar sesión en Sysacad. Intentá de nuevo.");
  }

  const alumno = parseAlumno(body);
  console.log("[sysacad] login ok — legajo:", legajo, "menu items:", menu.length);

  return { cookie, baseUrl, facultad, legajo, alumno, menu };
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE 1 — Lectura de páginas internas de Sysacad (datos de alumno).
//
// Todas las vistas comparten un esqueleto: <div class="tabla-contenido-ancho">
// con un <h3 class="titulo-tabla-menu"> (título + nombre del alumno) y una
// <table class="tabla-datos"> cuyas filas usan clases semánticas
// (fila-estado-academico, fila-plan, fila-materias-cursado).  Parseamos con
// regex defensivas sobre esas clases, igual que parseModules en
// app/api/course/route.ts, sin librerías externas.
// ─────────────────────────────────────────────────────────────────────────────

/** Sesión mínima necesaria para pedir páginas autenticadas (lo que guarda la cookie httpOnly). */
export interface SysacadAuth {
  cookie: string;
  baseUrl: string;
}

/**
 * Pide una página interna de Sysacad y devuelve su HTML decodificado como
 * latin1 (iso-8859-1) para que los acentos no se rompan.  Reusa la cookie de
 * sesión capturada en el login.  Un 302/301 significa que la sesión expiró →
 * quien llame debería re-autenticar.
 */
export async function sysacadFetch(auth: SysacadAuth, path: string): Promise<string> {
  const url = `${auth.baseUrl}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    headers: { Cookie: auth.cookie, Referer: `${auth.baseUrl}/menuAlumno.asp` },
    redirect: "manual",
  });
  if (res.status === 301 || res.status === 302) {
    throw new Error("La sesión de Sysacad expiró. Volvé a iniciar sesión.");
  }
  // iso-8859-1 → latin1 preserva ñ/á/é directamente (los chars vienen como bytes, no entities).
  return Buffer.from(await res.arrayBuffer()).toString("latin1");
}

// ─── Helpers de limpieza de HTML ──────────────────────────────────────────────

/** Decodifica las entidades que Sysacad emite, sin colapsar saltos de línea. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é").replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó").replace(/&uacute;/gi, "ú").replace(/&ntilde;/gi, "ñ")
    .replace(/&Aacute;/g, "Á").replace(/&Eacute;/g, "É").replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó").replace(/&Uacute;/g, "Ú").replace(/&Ntilde;/g, "Ñ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
}

/**
 * Convierte un fragmento HTML en texto plano.
 * - keepBreaks=false: una sola línea con espacios colapsados (campos simples).
 * - keepBreaks=true: respeta los <br> como saltos de línea (motivos / multilínea),
 *   descartando líneas vacías que deja el "&nbsp;".
 */
function htmlToText(html: string, keepBreaks = false): string {
  let out = html.replace(/<br\s*\/?>/gi, keepBreaks ? "\n" : " ");
  out = out.replace(/<[^>]+>/g, " ");
  out = decodeHtmlEntities(out);
  if (keepBreaks) {
    return out
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Devuelve el HTML interno de cada fila cuya clase contenga `rowClass`. */
function extractRows(html: string, rowClass: string): string[] {
  const body = stripNonContent(html);
  const re = new RegExp(
    `<tr[^>]*class="[^"]*\\b${rowClass}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/tr>`,
    "gi"
  );
  return [...body.matchAll(re)].map((m) => m[1]);
}

/** Resuelve un href relativo de Sysacad a URL absoluta. */
function absolutize(href: string, baseUrl: string): string {
  const clean = href.replace(/&amp;/g, "&").trim();
  if (!baseUrl || /^https?:\/\//i.test(clean)) return clean;
  return `${baseUrl}/${clean.replace(/^\//, "")}`;
}

// ─── Tipos de datos ───────────────────────────────────────────────────────────

/** Una materia en Estado Académico. */
export interface MateriaEstado {
  nivel: string;   // "0".."5" (año / nivel)
  materia: string;
  estado: string;  // raw: "Aprobada con 8 (5 hs.) Tomo: 190 Folio: 247" | "Cursa en 4K ..." | ""
  nota: string;    // nota numérica si la materia está aprobada ("8"), si no ""
  detalle: string; // estado legible: "Cantidad de horas: 5hs Tomo: 190 Folio: 247" o el estado tal cual
  plan: string;    // "Plan 2023"
}

/** Una materia en Correlatividades (puede o no cursarse). */
export interface MateriaCorrelativa {
  nivel: string;
  materia: string;
  puedeCursar: boolean; // true si el motivo dice "Puede cursar"
  motivo: string;       // "Puede cursar" | "No regularizó X (Ord. 1878)\n..."
  plan: string;
}

/** Una materia del plan de estudios. */
export interface MateriaPlan {
  nivel: string;
  periodo: string;  // "Anual" | "1c" | "2c" | "--"
  materia: string;
  seCursa: boolean;
  seRinde: boolean;
  electiva: boolean; // derivado de "(Elec.)" en el nombre
}

/** Una materia que el alumno está cursando (vista Notas de parciales). */
export interface MateriaCursando {
  nivel: string;
  materia: string;
  materiaUrl: string;  // webComisionAlumnos.asp?... (absoluta) → archivos del docente
  comision: string;    // "1 (4K)"
  modalidad: string;   // "Aula: 0 MODALIDAD PRESENCIAL"
  horario: string;     // "Miércoles 21:30-23:45"
  claveCampus: string; // "5202340212026"
  inasistencias: string;            // "1 (0 justificadas)"
  inasistenciasTotal: number;
  inasistenciasJustificadas: number;
  notasParciales: string;           // normalmente "" hasta que el docente carga
}

/** Resultado de una acción de Sysacad (cambio de contraseña, avisos, etc.). */
export interface SysacadMensaje {
  ok: boolean;
  mensaje: string;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Separa la nota y reformatea el estado de una materia aprobada.
 * "Aprobada con 6 (5 hs.) Tomo: 190 Folio: 108"
 *   → { nota: "6", detalle: "Cantidad de horas: 5hs Tomo: 190 Folio: 108" }
 * Cualquier otro estado ("Cursa en 4K ...", "Aprobada en 2023", "") se deja igual.
 */
function splitEstadoNota(estado: string): { nota: string; detalle: string } {
  const m = estado.match(/^Aprobada con\s+(\d+(?:[.,]\d+)?)\s*\(([\d.,]+)\s*hs\.?\)\s*(.*)$/i);
  if (!m) return { nota: "", detalle: estado };
  const [, nota, horas, resto] = m;
  const detalle = `Cantidad de horas: ${horas}hs${resto.trim() ? ` ${resto.trim()}` : ""}`;
  return { nota, detalle };
}

/** Núcleo compartido por Estado Académico y Correlatividades (misma fila). */
function parseFilasEstado(html: string): MateriaEstado[] {
  return extractRows(html, "fila-estado-academico")
    .map((row) => {
      const nivel = htmlToText(row.match(/<td[^>]*>\s*<div>([^<]*)<\/div>/i)?.[1] ?? "");
      // Bloque interno (materia + estado), desde tipo-columna hasta el cierre de la celda.
      const tipo = row.match(/tipo-columna[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "";
      const materia = htmlToText(tipo.match(/<div>([\s\S]*?)<\/div>/i)?.[1] ?? "");
      const estado = htmlToText(
        tipo.match(/class="color-gris-cursiva"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "",
        true
      );
      // El plan es el último <div> de texto plano antes de cerrar la celda.
      const plan = htmlToText(row.match(/<\/div>\s*<div>([^<]*)<\/div>\s*<\/td>/i)?.[1] ?? "");
      const { nota, detalle } = splitEstadoNota(estado);
      return { nivel, materia, estado, nota, detalle, plan };
    })
    .filter((m) => m.materia);
}

/** Estado académico: materias aprobadas / en curso con su nota. */
export function parseEstadoAcademico(html: string): MateriaEstado[] {
  return parseFilasEstado(html);
}

/** Correlatividades para cursar: qué se puede y qué falta. */
export function parseCorrelatividades(html: string): MateriaCorrelativa[] {
  return parseFilasEstado(html).map(({ nivel, materia, estado, plan }) => ({
    nivel,
    materia,
    plan,
    motivo: estado,
    puedeCursar: /puede cursar/i.test(estado),
  }));
}

/** Materias del plan de estudios. */
export function parseMaterias(html: string): MateriaPlan[] {
  return extractRows(html, "fila-plan")
    .map((row) => {
      const lead = row.match(/<td[^>]*>\s*<div>([^<]*)<\/div>\s*<div>([^<]*)<\/div>/i);
      const nivel = htmlToText(lead?.[1] ?? "");
      const periodo = htmlToText(lead?.[2] ?? "");
      const tipo = row.match(/tipo-columna[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "";
      const materia = htmlToText(tipo.match(/<div>([\s\S]*?)<\/div>/i)?.[1] ?? "");
      const detalle = tipo.match(/class="color-gris-cursiva"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
      return {
        nivel,
        periodo,
        materia,
        seCursa: /Se cursa:\s*Si/i.test(detalle),
        seRinde: /Se rinde:\s*Si/i.test(detalle),
        electiva: /\(Elec\.\)/i.test(materia),
      };
    })
    .filter((m) => m.materia);
}

/** Notas de parciales: materias en curso con comisión, horario e inasistencias. */
export function parseNotas(html: string, baseUrl = ""): MateriaCursando[] {
  return extractRows(html, "fila-materias-cursado")
    .map((row) => {
      const nivel = htmlToText(row.match(/<td[^>]*>\s*<div>([^<]*)<\/div>/i)?.[1] ?? "");
      const a = row.match(/nombre-materia-cursado"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const materiaUrl = a ? absolutize(a[1], baseUrl) : "";
      const materia = htmlToText(a?.[2] ?? "");
      // Los tres <div class="color-gris-cursiva"> son, en orden: comisión, modalidad, horario.
      const grises = [...row.matchAll(/class="color-gris-cursiva"[^>]*>([\s\S]*?)<\/div>/gi)].map(
        (m) => htmlToText(m[1])
      );
      const claveCampus = row.match(/Clave Campus:\s*([0-9]+)/i)?.[1] ?? "";
      const inas = row.match(/Inasistencias:\s*(\d+)\s*\((\d+)\s*justificadas?\)/i);
      const notasParciales = htmlToText(
        row.match(/class="notas-parciales[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "",
        true
      );
      return {
        nivel,
        materia,
        materiaUrl,
        comision: grises[0] ?? "",
        modalidad: grises[1] ?? "",
        horario: grises[2] ?? "",
        claveCampus,
        inasistencias: inas ? `${inas[1]} (${inas[2]} justificadas)` : "",
        inasistenciasTotal: inas ? Number(inas[1]) : 0,
        inasistenciasJustificadas: inas ? Number(inas[2]) : 0,
        notasParciales,
      };
    })
    .filter((m) => m.materia);
}

/** Título + nombre del alumno desde el <h3 class="titulo-tabla-menu">. */
export function parseTitulo(html: string): { titulo: string; alumno: string } {
  const raw = stripNonContent(html).match(/titulo-tabla-menu[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "";
  const titulo = htmlToText(raw);
  const alumno = titulo.match(/\bde\s+(.+?)\s+al\s+\d/i)?.[1]?.trim() ?? "";
  return { titulo, alumno };
}

/**
 * Lee el cartel de resultado que Sysacad muestra tras una acción
 * (clase `textoError`, con `color-exito` cuando salió bien).
 */
export function parseMensaje(html: string): SysacadMensaje | null {
  const body = stripNonContent(html);
  const m = body.match(
    /class="textoError([^"]*)"[^>]*>([\s\S]*?)<\/(?:div|p|td|h2|h3)>/i
  );
  if (!m) return null;
  return { ok: /color-exito/i.test(m[1]), mensaje: htmlToText(m[2], true) };
}

// ─── Resolución de rutas .asp desde el menú ───────────────────────────────────

/** Recursos de datos soportados (cada uno mapea a una página .asp del alumno). */
export type SysacadRecurso = "estado" | "correlatividades" | "materias" | "notas";

/**
 * Por cada recurso: palabras clave para encontrar su link en el menú del alumno
 * y una ruta `.asp` de respaldo por si el menú no lo expone.  Solo
 * `CambioPassword.asp` está confirmado; los fallbacks son la mejor estimación y
 * se sobreescriben automáticamente con el link real del menú cuando existe.
 */
const RECURSO_CONFIG: Record<
  SysacadRecurso,
  { keywords: string[]; fallback: string }
> = {
  estado: { keywords: ["estado académico", "estado academico"], fallback: "estadoAcademico.asp" },
  correlatividades: { keywords: ["correlativ"], fallback: "correlatividades.asp" },
  materias: { keywords: ["materias del plan", "materias"], fallback: "materias.asp" },
  notas: { keywords: ["notas"], fallback: "notasParciales.asp" },
};

/**
 * Resuelve la ruta `.asp` de un recurso buscando su link en el menú del alumno
 * (fuente de verdad), con fallback a la estimación de RECURSO_CONFIG.
 */
export async function resolveRecursoPath(
  auth: SysacadAuth,
  recurso: SysacadRecurso
): Promise<string> {
  const { keywords, fallback } = RECURSO_CONFIG[recurso];
  try {
    const menuHtml = stripNonContent(await sysacadFetch(auth, "menuAlumno.asp"));
    const menu = parseMenu(menuHtml, auth.baseUrl);
    const hit = menu.find((link) =>
      keywords.some((k) => link.label.toLowerCase().includes(k))
    );
    if (hit) return hit.href.replace(`${auth.baseUrl}/`, "");
  } catch {
    // Si el menú falla, usamos el fallback.
  }
  return fallback;
}

/**
 * Cambia la contraseña del alumno (form CambioPassword.asp:
 * passwordActual / password / pruebaPassword) y devuelve el resultado parseado.
 */
export async function cambiarPassword(
  auth: SysacadAuth,
  actual: string,
  nueva: string
): Promise<SysacadMensaje> {
  const res = await fetch(`${auth.baseUrl}/CambioPassword.asp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: auth.cookie,
      Referer: `${auth.baseUrl}/CambioPassword.asp`,
    },
    body: new URLSearchParams({
      passwordActual: actual,
      password: nueva,
      pruebaPassword: nueva,
    }),
    redirect: "manual",
  });
  const html = Buffer.from(await res.arrayBuffer()).toString("latin1");
  return (
    parseMensaje(html) ?? {
      ok: res.status === 200,
      mensaje:
        res.status === 200
          ? "Contraseña actualizada."
          : "No se pudo cambiar la contraseña.",
    }
  );
}
