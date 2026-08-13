/**
 * Cliente del sistema viejo de "Control de Asistencias" (asistencia.frsfco.utn.edu.ar,
 * PHP + Materialize, sin API — se scrapea igual que el resto del proyecto).
 *
 * Flujo (reconstruido de harfiles/asistencia):
 *  1. GET  /index.php            → sesión anónima (Set-Cookie de PHP)
 *  2. POST /index.php            → legajo + password (= DNI, mismo esquema que Sysacad)
 *  3. GET  /apply-leave.php      → si autenticó, trae el <select> de materias
 *                                   habilitadas AHORA MISMO (esto ya lo resuelve
 *                                   el servidor de la facultad — no hay que
 *                                   reimplementar la detección de "qué estás cursando")
 *                                   + la lista de "Asistencias registradas hoy"
 *  4. POST /verificar_ip.php     → ip=<IP pública del navegador> (chequeo de red
 *                                   de la facultad — se reenvía la IP real del
 *                                   alumno, nunca una inventada)
 *  5. POST /apply-leave.php      → id_materia + los hidden fields de esa opción
 *
 * El login y el submit de asistencia NO se llegaron a capturar en HAR (solo
 * sesiones ya autenticadas), así que esta implementación asume el shape del
 * <form> tal como está en el HTML servido.
 */

const BASE = "https://asistencia.frsfco.utn.edu.ar:4443";

export interface AsistenciaMateria {
  id: string;
  anio: string;
  especialidad: string;
  plan: string;
  comision: string;
  condicional: boolean;
  habilitada: boolean;
  nombre: string;
}

export interface AsistenciaRegistrada {
  materia: string;
  hora: string;
}

interface ApplyLeavePage {
  autenticado: boolean;
  materias: AsistenciaMateria[];
  registradasHoy: AsistenciaRegistrada[];
}

// ─── Cookie jar minimalista ────────────────────────────────────────────────────
// No conocemos el nombre real de la cookie de sesión de PHP (los HAR la traen
// redactada), así que se guarda cualquier Set-Cookie tal cual venga y se
// reenvía como header Cookie — sin asumir "PHPSESSID".

type Jar = Record<string, string>;

function getSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function mergeSetCookies(jar: Jar, setCookieHeaders: string[]): Jar {
  const out = { ...jar };
  for (const raw of setCookieHeaders) {
    const pair = raw.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

function cookieHeader(jar: Jar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ─── Parseo del HTML de apply-leave.php ────────────────────────────────────────

function decodeHtml(s: string): string {
  return s
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&ntilde;/g, "ñ")
    .replace(/&Aacute;/g, "Á").replace(/&Eacute;/g, "É").replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó").replace(/&Uacute;/g, "Ú").replace(/&Ntilde;/g, "Ñ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function parseApplyLeaveHtml(html: string): ApplyLeavePage {
  const autenticado = /id="materia"/.test(html);

  const materias: AsistenciaMateria[] = [];
  const optionRe =
    /<option\s+value="(\d+)"\s+data-anio="([^"]*)"\s+data-especialidad="([^"]*)"\s+data-plan="([^"]*)"\s+data-comision="([^"]*)"\s+data-condicional="([^"]*)"\s+data-habilitada="([^"]*)">\s*([\s\S]*?)<\/option>/g;
  let m: RegExpExecArray | null;
  while ((m = optionRe.exec(html))) {
    materias.push({
      id: m[1],
      anio: m[2],
      especialidad: m[3],
      plan: m[4],
      comision: m[5],
      condicional: m[6] === "S",
      habilitada: m[7] === "S",
      nombre: decodeHtml(m[8]).replace(/\s+/g, " ").trim(),
    });
  }

  const registradasHoy: AsistenciaRegistrada[] = [];
  const liRe = /<li class="collection-item">\s*([\s\S]*?)-\s*([\d:]+\s*hs)\s*<\/li>/g;
  while ((m = liRe.exec(html))) {
    registradasHoy.push({
      materia: decodeHtml(m[1]).replace(/\s+/g, " ").trim(),
      hora: m[2].trim(),
    });
  }

  return { autenticado, materias, registradasHoy };
}

async function fetchApplyLeave(cookie: string): Promise<{ html: string; page: ApplyLeavePage }> {
  const res = await fetch(`${BASE}/apply-leave.php`, {
    headers: { Cookie: cookie, Referer: `${BASE}/apply-leave.php` },
    cache: "no-store",
  });
  const html = await res.text();
  const page = parseApplyLeaveHtml(html);
  return { html, page };
}

/** Login contra el sistema viejo con legajo + DNI (mismo esquema que Sysacad). */
async function login(legajo: string, dni: string): Promise<string | null> {
  const r1 = await fetch(`${BASE}/index.php`, { cache: "no-store" });
  let jar = mergeSetCookies({}, getSetCookies(r1));

  const r2 = await fetch(`${BASE}/index.php`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE}/index.php`,
      Cookie: cookieHeader(jar),
    },
    body: `legajo=${encodeURIComponent(legajo)}&password=${encodeURIComponent(dni)}&ingreso=Ingresar`,
  });
  jar = mergeSetCookies(jar, getSetCookies(r2));

  const { page } = await fetchApplyLeave(cookieHeader(jar));
  if (!page.autenticado) {
    return null;
  }
  return cookieHeader(jar);
}

// La cookie de sesión persiste en el navegador sin estar atada al usuario de
// Sysacad. Si dos personas comparten dispositivo (una cierra sesión y la otra
// entra), reusar la cookie "tal cual" marcaría asistencia con la sesión de la
// persona anterior. Por eso se guarda con el legajo como prefijo y solo se
// reutiliza si coincide con el legajo actualmente autenticado.
function packSession(legajo: string, cookie: string): string {
  return `${legajo}::${cookie}`;
}

function unpackSession(raw: string | undefined, legajo: string): string | undefined {
  if (!raw) return undefined;
  const sep = raw.indexOf("::");
  if (sep === -1) return undefined; // cookie de un formato anterior sin legajo: no confiar
  if (raw.slice(0, sep) !== legajo) return undefined;
  return raw.slice(sep + 2);
}

/** Reutiliza la cookie guardada si sigue viva y es del mismo legajo; si no, hace login de nuevo. */
export async function ensureSession(existingRaw: string | undefined, legajo: string, dni: string): Promise<string | null> {
  const existingCookie = unpackSession(existingRaw, legajo);
  if (existingCookie) {
    const { page } = await fetchApplyLeave(existingCookie);
    if (page.autenticado) return existingCookie;
  }
  const fresh = await login(legajo, dni);
  return fresh;
}

/** Empaqueta la cookie de sesión junto con el legajo para guardarla en la cookie del navegador. */
export function packSessionForStorage(legajo: string, cookie: string): string {
  return packSession(legajo, cookie);
}

export async function getStatus(cookie: string): Promise<ApplyLeavePage> {
  const { page } = await fetchApplyLeave(cookie);
  return page;
}

/**
 * Chequeo de "estás en la red de la facultad". `ip` viene del propio navegador
 * del alumno (api.ipify.org) — se reenvía tal cual, nunca se inventa un valor,
 * así el chequeo sigue reflejando la ubicación real del dispositivo.
 */
export async function verificarIp(cookie: string, ip: string): Promise<boolean> {
  const res = await fetch(`${BASE}/verificar_ip.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE}/apply-leave.php`,
      Cookie: cookie,
    },
    body: `ip=${encodeURIComponent(ip)}`,
  });
  const text = await res.text();
  try {
    return (JSON.parse(text) as { acceso?: string }).acceso === "permitido";
  } catch {
    return false;
  }
}

/**
 * Marca asistencia para una materia (ya validada contra el <select> fresco por
 * el caller). El POST puede no confirmar in-line, así que el resultado se
 * corrobora releyendo "Asistencias registradas hoy".
 *
 * Si el servidor rechaza el marcado (p. ej. restricción anti-fraude de "un
 * dispositivo, un legajo por día"), responde 200 con un <script>alert("...")
 * en vez de registrar nada — se extrae ese texto para mostrarlo tal cual.
 */
export async function marcar(cookie: string, materia: AsistenciaMateria): Promise<{ page: ApplyLeavePage; rechazo: string | null }> {
  const body = new URLSearchParams({
    id_materia: materia.id,
    anio_academico: materia.anio,
    id_especialidad: materia.especialidad,
    id_plan: materia.plan,
    comision: materia.comision,
    signin: "",
  }).toString();

  const postRes = await fetch(`${BASE}/apply-leave.php`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE}/apply-leave.php`,
      Cookie: cookie,
    },
    body,
  });

  const postText = await postRes.text().catch(() => "");
  const alertMatch = postText.match(/alert\((['"])((?:\\.|(?!\1).)*)\1\)/);
  const rechazo = alertMatch ? alertMatch[2].replace(/\\'/g, "'").replace(/\\"/g, '"') : null;

  const { page } = await fetchApplyLeave(cookie);
  return { page, rechazo };
}

export type { ApplyLeavePage };
