import { NextRequest, NextResponse } from "next/server";
import { getCourses, callMoodleService, type MoodleCourse } from "@/lib/moodle";
import { isGuestRequest } from "@/lib/guest";
import { MOCK_TAREAS } from "@/lib/guestMockData";
import { CALENDAR_MONTHS } from "@/lib/calendario";

export const runtime = "nodejs";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

export interface TareaEvent {
  date: string; // YYYY-MM-DD
  kind: "tarea_inicio" | "tarea_fin";
  title: string;
  course: string;
  /** id del curso en Moodle → enlace a la materia en nuestro campus (/course/[id]). */
  courseId?: number;
  /** Enlace directo a la actividad en Moodle (mod/assign/view.php?id=XXXX). */
  url?: string;
  /** Clave de fusión entre fases (id del módulo extraído de la URL). */
  taskId?: string;
  /** Detalle enriquecido en la Fase 2 (descripción / comentarios del profesor). */
  detail?: string;
}

function isoFromUnix(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** id del módulo a partir de la URL (`...view.php?id=144899` → "144899"). Sirve de taskId. */
function taskIdFromUrl(url: string | undefined): string | undefined {
  return url?.match(/[?&]id=(\d+)/)?.[1];
}

// ─── Fase 1: calendario global de Moodle (core_calendar_get_calendar_monthly_view) ──
// Una llamada AJAX por mes — rápido y confiable (a diferencia del web service de
// assign, que está bloqueado). Devuelve aperturas/vencimientos de tareas y
// cuestionarios con su enlace directo, sin recorrer materia por materia.

/** Forma cruda de un evento del calendario de Moodle (monthly view). */
export interface MoodleCalendarEvent {
  id: number;
  name: string;
  activityname?: string;
  activitystr?: string;
  modulename?: string;          // "assign" | "quiz" | ...
  eventtype: string;            // "open" | "due" | "close"
  timestart: number;            // unix (segundos)
  timesort: number;
  url?: string;                 // enlace directo a la actividad
  viewurl?: string;             // enlace a la vista de día del calendario
  course?: { id: number; fullname: string } | string;
}

interface MoodleMonthlyView {
  weeks?: { days?: { events?: MoodleCalendarEvent[] }[] }[];
}

/** eventtype de Moodle → tipo de pill del calendario. */
function kindFromEventType(eventtype: string): TareaEvent["kind"] {
  return eventtype === "open" ? "tarea_inicio" : "tarea_fin";
}

async function fromMonthlyView(cookie: string, sesskey: string): Promise<TareaEvent[]> {
  const views = await Promise.all(
    CALENDAR_MONTHS.map(({ year, month }) =>
      callMoodleService(cookie, sesskey, "core_calendar_get_calendar_monthly_view", {
        year: String(year),
        month: String(month + 1), // Moodle usa meses 1-based
        courseid: 1,              // 1 = "Todos los cursos"
        day: 1,
        view: "monthblock",
      })
        .then((d) => d as unknown as MoodleMonthlyView)
        .catch(() => null)
    )
  );

  const events: TareaEvent[] = [];
  const seen = new Set<string>(); // dedupe entre meses solapados
  for (const view of views) {
    for (const week of view?.weeks ?? []) {
      for (const day of week.days ?? []) {
        for (const ev of day.events ?? []) {
          const kind = kindFromEventType(ev.eventtype);
          const dedupeKey = `${ev.id}-${kind}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          // Solo el enlace DIRECTO a la actividad (mod/.../view.php?id=…).
          // `viewurl` apunta a calendar/view.php (la vista de calendario de Moodle,
          // que parece "el campus") → no sirve como enlace a la tarea.
          const url = (ev.url || "").replace(/&amp;/g, "&");
          const course = typeof ev.course === "string" ? ev.course : ev.course?.fullname ?? "";
          // courseId: del objeto course o, si viene como string, del param course= de viewurl.
          const courseId =
            (typeof ev.course === "object" ? ev.course?.id : undefined) ??
            (Number(ev.viewurl?.match(/[?&]course=(\d+)/)?.[1]) || undefined);
          events.push({
            date: isoFromUnix(ev.timestart),
            kind,
            title: ev.activityname || ev.name,
            course,
            courseId,
            url: url || undefined,
            taskId: taskIdFromUrl(url),
          });
        }
      }
    }
  }
  return events;
}

// ─── Fuente principal: web service mod_assign_get_assignments ─────────────────
// (En esta instancia suele estar bloqueado para AJAX → cae al scraping.)
interface AssignWS { name: string; duedate: number; allowsubmissionsfromdate: number; cutoffdate: number }
interface AssignCourseWS { fullname: string; assignments: AssignWS[] }

async function fromWebService(cookie: string, sesskey: string): Promise<TareaEvent[]> {
  const data = (await callMoodleService(cookie, sesskey, "mod_assign_get_assignments", {
    courseids: [],
  })) as unknown as { courses?: AssignCourseWS[] };
  const events: TareaEvent[] = [];
  for (const c of data.courses ?? []) {
    for (const a of c.assignments ?? []) {
      if (a.allowsubmissionsfromdate > 0)
        events.push({ date: isoFromUnix(a.allowsubmissionsfromdate), kind: "tarea_inicio", title: a.name, course: c.fullname });
      const close = a.duedate || a.cutoffdate;
      if (close > 0)
        events.push({ date: isoFromUnix(close), kind: "tarea_fin", title: a.name, course: c.fullname });
    }
  }
  return events;
}

// ─── Fallback: scraping ───────────────────────────────────────────────────────

const MESES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10",
  noviembre: "11", diciembre: "12",
};
function toIso(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
  if (!m) return null;
  const mm = MESES[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
}
function clean(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

/** Extrae las tareas (url + nombre real) de un HTML de curso/sección. */
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

/** DBIDs de las secciones "resumen" (colapsadas), que requieren section.php. */
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

async function fetchAssignDates(cookie: string, url: string, name: string, course: string, courseId: number): Promise<TareaEvent[]> {
  try {
    const res = await fetch(url, { headers: { Cookie: cookie } });
    if (res.url.includes("/login/")) return [];
    const html = await res.text();
    // Nombre real: el del módulo del curso o, si falta, el <title> de la página.
    const title =
      name && name !== "Tarea"
        ? name
        : clean(html.match(/<title>([^<]*)<\/title>/i)?.[1]?.split(/[|›»]/)[0] ?? "") || "Tarea";
    const dateIdx = html.indexOf('data-region="activity-dates"');
    if (dateIdx === -1) return [];
    const chunk = html.slice(dateIdx, dateIdx + 800);
    const events: TareaEvent[] = [];
    const open = chunk.match(/Apertura:?\s*<\/strong>\s*([^<]+)/i)?.[1];
    const close = chunk.match(/Cierre:?\s*<\/strong>\s*([^<]+)/i)?.[1];
    const openIso = open ? toIso(open) : null;
    const closeIso = close ? toIso(close) : null;
    const taskId = taskIdFromUrl(url);
    // Descripción / consigna de la tarea (enriquecimiento Fase 2).
    const detail =
      clean(html.match(/<div[^>]*id="intro"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "").slice(0, 300) || undefined;
    if (openIso) events.push({ date: openIso, kind: "tarea_inicio", title, course, courseId, url, taskId, detail });
    if (closeIso) events.push({ date: closeIso, kind: "tarea_fin", title, course, courseId, url, taskId, detail });
    return events;
  } catch {
    return [];
  }
}

/** Lista de cursos: timeline classification + enrol (merge, para no perder ninguno). */
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

async function fromScrape(cookie: string, sesskey: string, userid: number): Promise<TareaEvent[]> {
  const courses = await listCourses(cookie, sesskey, userid);

  // Por cada curso: tareas de la página + de las secciones resumen.
  const perCourse = await Promise.all(
    courses.map(async (course) => {
      const assigns = new Map<string, string>(); // url → nombre

      // Suma tareas de un HTML: por módulo (con nombre) + cualquier href suelto.
      const collect = (html: string) => {
        for (const a of parseAssignModules(html)) {
          if (a.name && a.name !== "Tarea") assigns.set(a.url, a.name);
          else if (!assigns.has(a.url)) assigns.set(a.url, "");
        }
        for (const m of html.matchAll(/href="([^"]*\/mod\/assign\/view\.php\?id=\d+)"/g)) {
          const url = m[1].replace(/&amp;/g, "&");
          if (!assigns.has(url)) assigns.set(url, "");
        }
      };

      try {
        const res = await fetch(`${MOODLE_BASE}/course/view.php?id=${course.id}`, { headers: { Cookie: cookie } });
        const html = await res.text();
        collect(html);

        // Secciones colapsadas/resumen.
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
    .flatMap((c) => c.assigns.map(([url, name]) => ({ url, name, course: c.course, courseId: c.courseId })))
    .slice(0, 200);

  const results = await Promise.all(jobs.map((j) => fetchAssignDates(cookie, j.url, j.name, j.course, j.courseId)));
  return results.flat();
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
  if (isGuestRequest(req)) {
    const events: TareaEvent[] = MOCK_TAREAS.flatMap((t) => {
      const out: TareaEvent[] = [];
      if (t.due) out.push({ date: t.due.slice(0, 10), kind: "tarea_fin", title: t.title, course: t.course });
      if (t.open) out.push({ date: t.open.slice(0, 10), kind: "tarea_inicio", title: t.title, course: t.course });
      return out;
    });
    return NextResponse.json({ events });
  }

  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  const sesskey = req.cookies.get("moodle_sesskey")?.value ?? "";
  if (!sessionToken) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const cookie = `MoodleSession=${sessionToken}`;
  const userid = getUserId(req);
  const phase = req.nextUrl.searchParams.get("phase");

  // ── Fase 1: carga ultra-rápida desde el calendario global de Moodle ──────────
  if (phase === "quick") {
    try {
      const events = await fromMonthlyView(cookie, sesskey);
      return NextResponse.json({ events, source: "monthly" });
    } catch (err) {
      console.error("[calendar] monthly view error:", (err as Error).message);
      return NextResponse.json({ events: [], error: (err as Error).message });
    }
  }

  // ── Fase 2: enriquecimiento profundo (scraping materia por materia) ──────────
  // (default y phase=deep) — web service de assign primero, scraping de respaldo.
  try {
    const events = await fromWebService(cookie, sesskey);
    if (events.length > 0) return NextResponse.json({ events, source: "ws" });
  } catch (err) {
    console.log("[calendar] mod_assign_get_assignments no disponible:", (err as Error).message);
  }

  try {
    const events = await fromScrape(cookie, sesskey, userid);
    return NextResponse.json({ events, source: "scrape" });
  } catch (err) {
    console.error("[calendar] scrape error:", (err as Error).message);
    return NextResponse.json({ events: [], error: (err as Error).message });
  }
}
