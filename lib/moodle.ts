export const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

/** Node/undici expone los headers HTTP como si fueran Latin-1 (así lo pide el
 *  RFC), pero Moodle manda el `filename=` de Content-Disposition en UTF-8 crudo
 *  sin percent-encoding. El resultado son mojibake como "PresentaciÃ³n". Si
 *  reinterpretar los bytes como UTF-8 da un texto válido (sin U+FFFD) que
 *  vuelve a producir exactamente los mismos bytes, era mojibake y lo arreglamos;
 *  si no, dejamos el string como vino (nombre legítimamente en Latin-1/ASCII). */
function fixLatin1Mojibake(s: string): string {
  try {
    const bytes = Buffer.from(s, "latin1");
    const utf8 = bytes.toString("utf8");
    if (!utf8.includes("�") && Buffer.from(utf8, "utf8").equals(bytes)) return utf8;
  } catch { /* keep original */ }
  return s;
}

/** Extrae el filename de un header Content-Disposition, soportando tanto la
 *  forma extendida (filename*=UTF-8''%XX...) como la plana (filename="..."),
 *  normalizando el mojibake de esta última (ver fixLatin1Mojibake). */
export function decodeContentDispositionFilename(disp: string): string | null {
  const star = disp.match(/filename\*=UTF-8''([^;\r\n]+)/i)?.[1];
  if (star) {
    try { return decodeURIComponent(star); } catch { return star; }
  }
  const plain = disp.match(/filename="?([^";\r\n]+)"?/i)?.[1];
  if (!plain) return null;
  return fixLatin1Mojibake(plain);
}

/** Resuelve un href de Moodle (relativo o absoluto) a una URL absoluta. */
export function absMoodleUrl(url: string): string {
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${MOODLE_BASE}${url}`;
  return url;
}

/** Convierte una URL de Moodle (absoluta o relativa) en una ruta same-origin
 *  bajo /api/cvg, para que el navegador nunca navegue directo al campus viejo. */
export function toProxyPath(url: string): string {
  const abs = absMoodleUrl(url);
  return abs.startsWith(MOODLE_BASE) ? abs.replace(MOODLE_BASE, "/api/cvg") : abs;
}

/** Reescribe hrefs/srcs de Moodle (relativos o absolutos) dentro de un bloque de
 *  HTML (summaries, labels) para que apunten a /api/cvg en vez de al dominio real. */
export function rewriteMoodleHtml(html: string): string {
  const escapedBase = MOODLE_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html
    .replace(new RegExp(`\\b(href|src)="${escapedBase}`, "g"), '$1="/api/cvg')
    .replace(/\b(href|src)="\/(?!\/)/g, '$1="/api/cvg/');
}

/** Recorre cualquier valor JSON (de una respuesta cruda de Moodle vía
 *  /api/moodle) y reemplaza toda aparición del dominio real por /api/cvg, para
 *  que ningún campo de ninguna llamada AJAX (avatares, perfiles, etc.) filtre
 *  el dominio del campus viejo al cliente. */
export function rewriteMoodleUrlsDeep<T>(value: T): T {
  if (typeof value === "string") {
    return value.split(MOODLE_BASE).join("/api/cvg") as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => rewriteMoodleUrlsDeep(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteMoodleUrlsDeep(v);
    }
    return out as T;
  }
  return value;
}

export interface MoodleSession {
  cookie: string;
  sesskey: string;
  userid: number;
  fullname: string;
  username: string;
}

export interface MoodleCourse {
  id: number;
  fullname: string;
  shortname: string;
  courseimage: string;
  viewurl: string;
  progress: number;
  hasprogress: boolean;
  coursecategory: string;
  startdate: number;
  enddate: number;
}

export interface MoodleCourseSection {
  id: number;
  name: string;
  visible: number;
  summaryHtml: string;
  modules: MoodleModule[];
}

export interface MoodleModule {
  id: number;
  name: string;
  modname: string;
  modicon: string;
  url?: string;
  contents?: MoodleContent[];
  description?: string;
  /** Solo para carpetas con "Mostrar en la página del curso": el árbol de
   *  archivos ya viene resuelto acá porque mod/folder/view.php no sirve para
   *  ese modo (Moodle lo redirige de vuelta al curso). */
  folderEntries?: import("@/lib/folderTree").FolderTreeNode[];
  folderDownloadUrl?: string;
  visible: number;
}

export interface MoodleContent {
  type: string;
  filename: string;
  filesize: number;
  fileurl?: string;
  mimetype?: string;
  timemodified: number;
  fileType?: string;    // extracted from Moodle icon URL: "pdf", "powerpoint", "document", …
}

export async function moodleLogin(
  username: string,
  password: string
): Promise<MoodleSession> {
  // Step 1: fetch login page — capture BOTH logintoken AND the pre-session cookie.
  // Moodle ties the logintoken to that pre-session for CSRF validation; without
  // sending the pre-session in Step 2 the login POST is rejected silently.
  console.log("[moodle] Step 1: fetching login token + pre-session...");
  const loginPageRes = await fetch(`${MOODLE_BASE}/login/index.php`);
  const loginPageHtml = await loginPageRes.text();
  const logintoken = loginPageHtml.match(/name="logintoken" value="([^"]+)"/)?.[1] ?? "";
  const preSession = loginPageRes.headers
    .get("set-cookie")
    ?.match(/MoodleSession=([^;]+)/)?.[1] ?? "";
  console.log("[moodle] logintoken:", logintoken ? "found" : "not found");
  console.log("[moodle] pre-session:", preSession ? "found" : "not found");

  // Step 2: POST credentials — must include the pre-session cookie so Moodle can
  // validate the logintoken and upgrade the session to an authenticated one.
  console.log("[moodle] Step 2: posting credentials...");
  const loginHeaders: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (preSession) loginHeaders["Cookie"] = `MoodleSession=${preSession}`;

  const res = await fetch(`${MOODLE_BASE}/login/index.php`, {
    method: "POST",
    headers: loginHeaders,
    body: new URLSearchParams({ username, password, logintoken }),
    redirect: "manual",
  });

  let location = res.headers.get("location") ?? "";
  let moodleSession = res.headers.get("set-cookie")?.match(/MoodleSession=([^;]+)/)?.[1] ?? "";
  let uidFromUrl = 0;

  console.log("[moodle] login status:", res.status, "→", location);

  // Moodle redirects to ?testsession=USERID after a successful login to verify the
  // client sends cookies back.  Follow that URL with our cookie so Moodle
  // considers cookies confirmed, then grab the next redirect destination.
  if (location.includes("testsession=")) {
    uidFromUrl = parseInt(location.match(/testsession=(\d+)/)?.[1] ?? "0");
    const testUrl = location.startsWith("http") ? location : `${MOODLE_BASE}${location}`;
    console.log("[moodle] cookie-test redirect, userid from URL:", uidFromUrl);
    const testRes = await fetch(testUrl, {
      headers: { Cookie: `MoodleSession=${moodleSession || preSession}` },
      redirect: "manual",
    });
    const testSession = testRes.headers.get("set-cookie")?.match(/MoodleSession=([^;]+)/)?.[1];
    if (testSession) moodleSession = testSession;
    location = testRes.headers.get("location") ?? "";
    console.log("[moodle] after cookie test →", location);
  }

  // NOTE: A failed login on this instance redirects to /login/index.php?loginredirect=1
  // (the SAME URL a fresh-login cookie-test can use), so the redirect target alone is
  // NOT a reliable success/failure signal. Authentication is verified authoritatively
  // below (Step 2.5) by re-requesting the login page.

  // Some Moodle versions don't issue a new session on the POST / testsession step;
  // the session is upgraded in-place.  Follow loginredirect=1 once to trigger it.
  if (!moodleSession || moodleSession === preSession) {
    if (location) {
      const followUrl = location.startsWith("http") ? location : `${MOODLE_BASE}${location}`;
      console.log("[moodle] following redirect:", followUrl);
      const redir = await fetch(followUrl, {
        headers: preSession ? { Cookie: `MoodleSession=${preSession}` } : {},
        redirect: "manual",
      });
      const redirSession = redir.headers.get("set-cookie")?.match(/MoodleSession=([^;]+)/)?.[1];
      if (redirSession) moodleSession = redirSession;
      console.log("[moodle] session after redirect:", redirSession ? "found" : "none");
    }
    if (!moodleSession) moodleSession = preSession;
  }

  if (!moodleSession) {
    throw new Error("Login fallido. Verificá usuario y contraseña.");
  }

  let cookie = `MoodleSession=${moodleSession}`;

  // Step 2.5: AUTHORITATIVE auth check.
  // This Moodle serves /my/courses.php to UNAUTHENTICATED sessions as a guest
  // (HTTP 200, with a throwaway sesskey and even a guest userId), so a protected
  // page cannot confirm login. Instead, re-request the login page: Moodle redirects
  // authenticated users away from it, while a failed login still renders the form
  // (logintoken present). This is the reliable wrong-credentials signal.
  console.log("[moodle] Step 2.5: verifying authentication...");
  const verifyRes = await fetch(`${MOODLE_BASE}/login/index.php`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  const verifyHtml = verifyRes.status === 200 ? await verifyRes.text() : "";
  if (verifyHtml.includes('name="logintoken"')) {
    console.log("[moodle] verification FAILED — login form still shown → bad credentials");
    // Moodle returns one generic error for both a wrong password and a
    // non-existent user (anti username-enumeration), so we cannot tell which.
    throw new Error("Usuario o contraseña incorrectos.");
  }
  console.log("[moodle] verification OK — session is authenticated");

  // Step 3: fetch a protected page to verify auth and extract sesskey + user info.
  console.log("[moodle] Step 3: fetching dashboard...");
  const dashRes = await fetch(`${MOODLE_BASE}/my/courses.php`, {
    headers: { Cookie: cookie },
  });

  // Moodle may regenerate the session on first authenticated access.
  // The sesskey in the response HTML is tied to the NEW session token, so we
  // must update our cookie reference or the AJAX calls will get sesskey mismatch.
  const dashNewSession = dashRes.headers
    .get("set-cookie")
    ?.match(/MoodleSession=([^;]+)/)?.[1];
  if (dashNewSession && dashNewSession !== moodleSession) {
    console.log("[moodle] session regenerated on dashboard load — updating token");
    moodleSession = dashNewSession;
    cookie = `MoodleSession=${moodleSession}`;
  }

  const html = await dashRes.text();
  console.log("[moodle] dashboard final url:", dashRes.url, "status:", dashRes.status);
  console.log("[moodle] dashboard html length:", html.length);

  if (dashRes.url.includes("/login/") || html.includes('name="logintoken"')) {
    throw new Error("Usuario o contraseña incorrectos.");
  }

  const sesskey = html.match(/"sesskey":"([^"]+)"/)?.[1] ?? "";

  // Moodle 4.x embeds "userId" (camelCase) in M.cfg; older versions used "userid".
  const userid = uidFromUrl || parseInt(
    html.match(/"userId"\s*:\s*(\d+)/)?.[1] ??      // Moodle 4.x camelCase
    html.match(/"userid"\s*:\s*(\d+)/)?.[1] ??      // older lowercase
    html.match(/"userid"\s*:\s*"(\d+)"/)?.[1] ??    // string-quoted variant
    html.match(/user\/(?:profile|view)\.php\?id=(\d+)/)?.[1] ??  // profile link fallback
    "0"
  );

  // Fullname: M.cfg JSON → user menu span (adaptable theme: class="usertext")
  const fullnameRaw =
    html.match(/"fullname"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ??
    html.match(/class="[^"]*usertext[^"]*"[^>]*>([^<]+)</)?.[1] ??
    html.match(/class="[^"]*(?:fullname|username)[^"]*"\s*>([^<]+)</)?.[1] ??
    "";
  const fullname = fullnameRaw
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"')
    .trim();

  const usernameMatch = html.match(/"username"\s*:\s*"([^"]+)"/)?.[1] ?? username;

  if (process.env.NODE_ENV !== "production") {
    console.log("[moodle] sesskey:", sesskey ? "found" : "NOT FOUND");
    console.log("[moodle] userid:", userid, uidFromUrl ? "(from testsession URL)" : "(from HTML)");
    console.log("[moodle] fullname:", fullname || "not found (will use username)");
  }

  if (!sesskey) {
    throw new Error("No se pudo obtener la sesión. Intentá de nuevo.");
  }

  // Extra guard: an enrolled student always has at least one course; a guest /
  // throwaway session resolves to zero. If the user has NO courses, treat it as
  // invalid credentials (usuario inexistente o contraseña incorrecta).
  // Only reject on a CONFIRMED empty result (primary API + enrol fallback);
  // transient service errors are ignored so a valid login is never blocked.
  console.log("[moodle] Step 4: course-count guard...");
  let courseCount = -1;
  try {
    courseCount = (await getCourses(cookie, sesskey)).length;
    if (courseCount === 0 && userid) {
      const fallback = (await callMoodleService(
        cookie,
        sesskey,
        "core_enrol_get_users_courses",
        { userid }
      )) as unknown;
      courseCount = Array.isArray(fallback) ? fallback.length : 0;
    }
  } catch (err) {
    console.log("[moodle] course-count guard skipped:", (err as Error).message);
  }
  console.log("[moodle] course count:", courseCount);
  if (courseCount === 0) {
    throw new Error("Usuario o contraseña incorrectos.");
  }

  return {
    cookie,
    sesskey,
    userid,
    fullname: fullname || username,
    username: usernameMatch,
  };
}

/**
 * Mantiene viva la sesión de Moodle. Pide una página protegida con el token
 * actual; si Moodle regeneró la sesión devuelve el nuevo token (para guardarlo),
 * de lo contrario devuelve el mismo. Best-effort: cualquier error se propaga al
 * llamador, que decide si seguir usando el token previo.
 */
export async function refreshMoodleSession(
  sessionToken: string
): Promise<{ token: string; alive: boolean }> {
  const res = await fetch(`${MOODLE_BASE}/my/`, {
    headers: { Cookie: `MoodleSession=${sessionToken}` },
    redirect: "manual",
  });
  const rotated = res.headers.get("set-cookie")?.match(/MoodleSession=([^;]+)/)?.[1];
  const loc = res.headers.get("location") ?? "";
  // Sesión viva: /my/ responde 200 o redirige dentro de /my/. Si rebota al login
  // o al front (?redirect=0), la sesión murió.
  const alive = res.status === 200 || loc.includes("/my/");
  return { token: rotated || sessionToken, alive };
}

export async function callMoodleService(
  cookie: string,
  sesskey: string,
  methodname: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const url = sesskey
    ? `${MOODLE_BASE}/lib/ajax/service.php?sesskey=${sesskey}&info=${methodname}`
    : `${MOODLE_BASE}/lib/ajax/service.php?info=${methodname}`;

  const body = JSON.stringify([{ index: 0, methodname, args }]);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });

  const json = await res.json();
  if (json[0]?.error) {
    throw new Error(json[0].exception?.message ?? "Error de Moodle");
  }
  return json[0]?.data ?? {};
}

export async function getCourses(
  cookie: string,
  sesskey: string
): Promise<MoodleCourse[]> {
  const data = await callMoodleService(
    cookie,
    sesskey,
    "core_course_get_enrolled_courses_by_timeline_classification",
    {
      offset: 0,
      limit: 0,
      classification: "all",
      customfieldname: "",
      customfieldvalue: "",
      searchvalue: "",
    }
  );
  return (data.courses as MoodleCourse[]) ?? [];
}

export async function getCourseContents(
  cookie: string,
  sesskey: string,
  courseId: number
): Promise<MoodleCourseSection[]> {
  const data = await callMoodleService(
    cookie,
    sesskey,
    "core_course_get_contents",
    { courseid: courseId }
  );
  return (data as unknown as MoodleCourseSection[]) ?? [];
}
