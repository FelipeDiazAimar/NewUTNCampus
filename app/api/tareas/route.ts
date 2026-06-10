import { NextRequest, NextResponse } from "next/server";
import { getCourses, callMoodleService, type MoodleCourse } from "@/lib/moodle";

export const runtime = "nodejs";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

/**
 * Tarea consolidada de todos los cursos del alumno. Reúne — vía scraping — el
 * nombre, la materia, las fechas de apertura/cierre y el estado de la entrega de
 * cada `mod/assign`. Mismo enfoque que `/api/calendar`, pero con el estado de la
 * entrega para poder separar Pendientes de Completadas.
 */
export interface TareaItem {
  id: string;            // cmid
  url: string;           // mod/assign/view.php?id=…
  title: string;
  course: string;
  courseId: number;
  open: string | null;   // ISO (con hora) — apertura
  due: string | null;    // ISO (con hora) — cierre
  dueLabel: string;      // fecha de cierre tal cual la muestra Moodle
  submitted: boolean;
  graded: boolean;
  grade: string;         // ej "8 / 10"
  status: string;        // "Enviado para calificar", "No entregado", …
}

// ─── Helpers de parseo HTML ───────────────────────────────────────────────────

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, " ");
}
function clean(s: string): string {
  return decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

const MESES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
  noviembre: 10, diciembre: 11,
};

/** "viernes, 5 de junio de 2026, 21:17" → ISO local con hora. */
function spanishToIso(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})(?:,?\s*(\d{1,2}):(\d{2}))?/i);
  if (!m) return null;
  const month = MESES[m[2].toLowerCase()];
  if (month === undefined) return null;
  const d = new Date(+m[3], month, +m[1], +(m[4] ?? 0), +(m[5] ?? 0));
  if (Number.isNaN(d.getTime())) return null;
  // ISO local (sin Z): mantiene la hora local del alumno.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

/** Tareas (url + nombre real) dentro de un HTML de curso/sección. */
function parseAssignModules(html: string): { url: string; name: string }[] {
  const out: { url: string; name: string }[] = [];
  const positions = [...html.matchAll(/id="module-(\d+)"/g)];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index!;
    const end = positions[i + 1]?.index ?? html.length;
    const chunk = html.slice(start, end);
    if (!/modtype_assign/.test(chunk)) continue;
    const href = chunk.match(/href="([^"]*\/mod\/assign\/view\.php\?id=\d+)"/)?.[1];
    if (!href) continue;
    const rawName =
      chunk.match(/data-activityname="([^"]+)"/)?.[1] ??
      chunk.match(/class="[^"]*instancename[^"]*">([\s\S]*?)<\/span>/)?.[1] ??
      "";
    out.push({ url: href.replace(/&amp;/g, "&"), name: clean(rawName) || "Tarea" });
  }
  return out;
}

/** DBIDs de secciones "resumen" (colapsadas) → requieren section.php. */
function summarySectionIds(html: string): string[] {
  const ids: string[] = [];
  const positions = [...html.matchAll(/id="section-\d+"/g)];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index!;
    const tag = html.slice(start, start + 800);
    if (tag.includes("section-summary")) {
      const dbId = tag.match(/\bdata-id="(\d+)"/)?.[1];
      if (dbId) ids.push(dbId);
    }
  }
  return ids;
}

/** Año lectivo de un curso (según su fecha de inicio). */
function courseYear(c: MoodleCourse): number {
  if (c.startdate && c.startdate > 0) return new Date(c.startdate * 1000).getFullYear();
  if (c.enddate && c.enddate > 0) return new Date(c.enddate * 1000).getFullYear();
  return new Date().getFullYear();
}

/** Lista de cursos: timeline + enrol (merge para no perder ninguno). */
async function listCourses(cookie: string, sesskey: string, userid: number): Promise<MoodleCourse[]> {
  const byId = new Map<number, MoodleCourse>();
  try {
    for (const c of await getCourses(cookie, sesskey)) byId.set(c.id, c);
  } catch { /* ignore */ }
  if (userid) {
    try {
      const enrol = (await callMoodleService(cookie, sesskey, "core_enrol_get_users_courses", { userid })) as unknown as MoodleCourse[];
      for (const c of enrol ?? []) if (c?.id && !byId.has(c.id)) byId.set(c.id, c);
    } catch { /* ignore */ }
  }
  return [...byId.values()];
}

// ─── Estado de la entrega desde la página del assign ──────────────────────────

interface AssignDetail {
  title: string;
  open: string | null;
  due: string | null;
  dueLabel: string;
  submitted: boolean;
  graded: boolean;
  grade: string;
  status: string;
}

async function fetchAssignDetail(
  cookie: string,
  url: string,
  name: string
): Promise<AssignDetail | null> {
  try {
    const res = await fetch(url, { headers: { Cookie: cookie } });
    if (res.url.includes("/login/")) return null;
    const html = await res.text();

    const title =
      name && name !== "Tarea"
        ? name
        : clean(html.match(/<h2[^>]*>([^<]+)<\/h2>/)?.[1] ?? "") ||
          clean(html.match(/<title>([^<]*)<\/title>/i)?.[1]?.split(/[|›»]/)[0] ?? "") ||
          "Tarea";

    // Fechas de actividad (Apertura / Cierre).
    let open: string | null = null;
    let due: string | null = null;
    let dueLabel = "";
    const dateIdx = html.indexOf('data-region="activity-dates"');
    if (dateIdx !== -1) {
      const chunk = html.slice(dateIdx, dateIdx + 800);
      const openRaw = chunk.match(/Apertura:?\s*<\/strong>\s*([^<]+)/i)?.[1]?.trim();
      const closeRaw = chunk.match(/Cierre:?\s*<\/strong>\s*([^<]+)/i)?.[1]?.trim();
      if (openRaw) open = spanishToIso(decode(openRaw));
      if (closeRaw) {
        dueLabel = decode(closeRaw);
        due = spanishToIso(dueLabel);
      }
    }

    // Tabla de estado de la entrega.
    let status = "";
    let grade = "";
    const tableIdx = html.indexOf('class="submissionstatustable"');
    if (tableIdx !== -1) {
      const chunk = html.slice(tableIdx, tableIdx + 6000);
      for (const m of chunk.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        // La etiqueta va en <th scope="row"> y el valor en <td>.
        const cells = [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)];
        if (cells.length < 2) continue;
        const label = clean(cells[0][1]).toLowerCase();
        const value = clean(cells[1][1]);
        if (/estado de (la )?entrega/.test(label)) status = value;
        else if (/calificaci/.test(label)) grade = value;
      }
    }

    // "Entregado" SOLO con archivos de entrega reales (submission_files) o estado
    // "Enviado para calificar". `fileuploadsubmission` también lo usan los adjuntos
    // de la consigna del profesor (introattachment), así que no sirve como señal.
    const submitted =
      /mod_assign\/submission_files/i.test(html) ||
      /submissionstatussubmitted/i.test(html) ||
      /enviado para calificar/i.test(status);
    const graded = !!grade && !/sin calificar|^-$/i.test(grade.trim());

    return { title, open, due, dueLabel, submitted, graded, grade, status };
  } catch {
    return null;
  }
}

function getUserId(req: NextRequest): number {
  const raw = req.cookies.get("moodle_user")?.value;
  if (!raw) return 0;
  try {
    return Number(JSON.parse(raw).userid) || 0;
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const sesskey = req.cookies.get("moodle_sesskey")?.value ?? "";
  if (!sessionToken) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const cookie = `MoodleSession=${sessionToken}`;
  const userid = getUserId(req);

  const currentYear = new Date().getFullYear();
  const reqYear = Number(req.nextUrl.searchParams.get("year")) || currentYear;

  try {
    const allCourses = await listCourses(cookie, sesskey, userid);

    // Años disponibles = años en los que el alumno cursó algo (desc). Esto evita
    // escanear todos los años: solo se scrapean los cursos del año pedido.
    const years = [...new Set(allCourses.map(courseYear))].sort((a, b) => b - a);
    if (years.length === 0) years.push(currentYear);
    // Si el año pedido no existe (no hubo cursos), caemos al más reciente.
    const year = years.includes(reqYear) ? reqYear : years[0];
    const courses = allCourses.filter((c) => courseYear(c) === year);

    // Por curso: junta las URLs de tareas (página + secciones resumen).
    const perCourse = await Promise.all(
      courses.map(async (course) => {
        const assigns = new Map<string, string>(); // url → nombre
        const collect = (html: string) => {
          for (const a of parseAssignModules(html)) {
            if (a.name && a.name !== "Tarea") assigns.set(a.url, a.name);
            else if (!assigns.has(a.url)) assigns.set(a.url, "");
          }
          for (const m of html.matchAll(/href="([^"]*\/mod\/assign\/view\.php\?id=\d+)"/g)) {
            const u = m[1].replace(/&amp;/g, "&");
            if (!assigns.has(u)) assigns.set(u, "");
          }
        };

        try {
          const res = await fetch(`${MOODLE_BASE}/course/view.php?id=${course.id}`, { headers: { Cookie: cookie } });
          const html = await res.text();
          collect(html);

          // Secciones colapsadas/resumen → su contenido vive en section.php.
          const summaries = summarySectionIds(html).slice(0, 30);
          const sectionHtmls = await Promise.all(
            summaries.map((dbId) =>
              fetch(`${MOODLE_BASE}/course/section.php?id=${dbId}`, { headers: { Cookie: cookie } })
                .then((r) => r.text())
                .catch(() => "")
            )
          );
          for (const sHtml of sectionHtmls) collect(sHtml);
        } catch { /* ignore */ }

        return { course: course.fullname, courseId: course.id, assigns: [...assigns.entries()] };
      })
    );

    const jobs = perCourse
      .flatMap((c) =>
        c.assigns.map(([url, name]) => ({ url, name, course: c.course, courseId: c.courseId }))
      )
      .slice(0, 180);

    const results = await Promise.all(
      jobs.map(async (j) => {
        const detail = await fetchAssignDetail(cookie, j.url, j.name);
        if (!detail) return null;
        const id = j.url.match(/[?&]id=(\d+)/)?.[1] ?? "";
        return {
          id,
          url: j.url,
          title: detail.title,
          course: j.course,
          courseId: j.courseId,
          open: detail.open,
          due: detail.due,
          dueLabel: detail.dueLabel,
          submitted: detail.submitted,
          graded: detail.graded,
          grade: detail.grade,
          status: detail.status,
        } satisfies TareaItem;
      })
    );

    const tareas = results.filter((t): t is TareaItem => t !== null);
    return NextResponse.json({ tareas, years, year });
  } catch (err) {
    console.error("[tareas]", (err as Error).message);
    return NextResponse.json({ tareas: [], years: [currentYear], year: reqYear, error: (err as Error).message }, { status: 500 });
  }
}
