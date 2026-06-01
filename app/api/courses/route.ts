import { NextRequest, NextResponse } from "next/server";
import type { MoodleCourse } from "@/lib/moodle";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string) {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function uniqueById(courses: MoodleCourse[]) {
  const seen = new Set<number>();
  return courses.filter((course) => {
    if (seen.has(course.id)) return false;
    seen.add(course.id);
    return true;
  });
}

function parseSesskey(html: string) {
  return html.match(/"sesskey"\s*:\s*"([^"]+)"/i)?.[1] ?? "";
}

async function fetchAjaxCourses(sessionToken: string, sesskey: string) {
  const endpoint = `${MOODLE_BASE}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}`;
  const baseArgs = {
    limit: 0,
    offset: 0,
    sort: "fullname",
    customfieldname: "",
    customfieldvalue: "",
  };

  const payloads = [
    {
      index: 0,
      methodname: "core_course_get_enrolled_courses_by_timeline_classification",
      args: { ...baseArgs, classification: "all" },
    },
    {
      index: 0,
      methodname: "core_course_get_enrolled_courses_by_timeline_classification",
      args: { ...baseArgs, classification: "inprogress" },
    },
    {
      index: 0,
      methodname: "block_myoverview_get_courses",
      args: {
        sort: "fullname",
        limit: 0,
        offset: 0,
        classification: "inprogress",
        searchvalue: "",
        categoryid: 0,
        courseids: [],
      },
    },
  ];

  for (const payload of payloads) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `MoodleSession=${sessionToken}`,
      },
      body: JSON.stringify([payload]),
    });

    if (!res.ok) continue;
    const json = (await res.json()) as Array<{ error?: string; data?: { courses?: MoodleCourse[] } }>;
    const courses = json?.[0]?.data?.courses ?? [];
    if (courses.length > 0) return courses;
  }

  return [] as MoodleCourse[];
}

function parseCourses(html: string): MoodleCourse[] {
  const matches = [...html.matchAll(/href=['"][^'"]*\/course\/view\.php\?id=(\d+)[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi)];
  const results: MoodleCourse[] = matches.map((match) => {
    const id = parseInt(match[1]);
    const name = stripTags(match[2]) || `Curso ${id}`;
    return {
      id,
      fullname: name,
      shortname: name,
      courseimage: "",
      viewurl: `${MOODLE_BASE}/course/view.php?id=${id}`,
      progress: 0,
      hasprogress: false,
      coursecategory: "",
      startdate: 0,
      enddate: 0,
    };
  });

  if (results.length > 0) return uniqueById(results);

  const cardIdMatches = [...html.matchAll(/data-course(?:-id|id)=["'](\d+)["']/gi)];
  const cardResults: MoodleCourse[] = cardIdMatches.map((match) => {
    const id = parseInt(match[1]);
    const start = Math.max(0, (match.index ?? 0) - 200);
    const chunk = html.slice(start, start + 3000);

    const nameRaw =
      chunk.match(/data-course-name=["']([^"']+)["']/i)?.[1] ??
      chunk.match(/data-course-title=["']([^"']+)["']/i)?.[1] ??
      chunk.match(/data-coursefullname=["']([^"']+)["']/i)?.[1] ??
      chunk.match(/class=["'][^"']*multiline[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ??
      chunk.match(/class=["'][^"']*coursename[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] ??
      chunk.match(/class=["'][^"']*card-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] ??
      chunk.match(/aria-label=["']([^"']+)["']/i)?.[1] ??
      "";

    const name = stripTags(nameRaw.replace(/^Ir a\s+/i, "")) || `Curso ${id}`;

    return {
      id,
      fullname: name,
      shortname: name,
      courseimage: "",
      viewurl: `${MOODLE_BASE}/course/view.php?id=${id}`,
      progress: 0,
      hasprogress: false,
      coursecategory: "",
      startdate: 0,
      enddate: 0,
    };
  });

  if (cardResults.length > 0) return uniqueById(cardResults);

  const courseIdMatches = [...html.matchAll(/data-courseid="(\d+)"/gi)];
  const fallbackResults: MoodleCourse[] = courseIdMatches.map((match) => {
    const id = parseInt(match[1]);
    const start = match.index ?? 0;
    const chunk = html.slice(start, start + 2000);

    const nameRaw =
      chunk.match(/data-course-name="([^"]+)"/i)?.[1] ??
      chunk.match(/data-course-title="([^"]+)"/i)?.[1] ??
      chunk.match(/aria-label="([^"]+)"/i)?.[1] ??
      chunk.match(/class="[^"]*coursename[^"]*"[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ??
      chunk.match(/class="[^"]*multiline[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ??
      "";

    const name = stripTags(nameRaw) || `Curso ${id}`;

    return {
      id,
      fullname: name,
      shortname: name,
      courseimage: "",
      viewurl: `${MOODLE_BASE}/course/view.php?id=${id}`,
      progress: 0,
      hasprogress: false,
      coursecategory: "",
      startdate: 0,
      enddate: 0,
    };
  });

  return uniqueById(fallbackResults);
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get("moodle_session_token")?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const res = await fetch(`${MOODLE_BASE}/my/courses.php`, {
      headers: { Cookie: `MoodleSession=${sessionToken}` },
    });
    const html = await res.text();
    if (res.url.includes("/login/") || html.includes("logintoken")) {
      return NextResponse.json({ error: "Sesion expirada" }, { status: 401 });
    }
    let courses = parseCourses(html);
    if (courses.length === 0) {
      const sesskey = parseSesskey(html);
      if (sesskey) {
        courses = await fetchAjaxCourses(sessionToken, sesskey);
      }
    }
    return NextResponse.json({ data: courses });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Error al obtener cursos" },
      { status: 500 }
    );
  }
}
