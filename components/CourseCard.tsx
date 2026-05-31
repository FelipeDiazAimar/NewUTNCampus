import Link from "next/link";
import type { MoodleCourse } from "@/lib/moodle";

interface CourseCardProps {
  course: MoodleCourse;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Nivel I": "bg-emerald-100 text-emerald-700",
  "Nivel II": "bg-blue-100 text-blue-700",
  "Nivel III": "bg-violet-100 text-violet-700",
  "Nivel IV": "bg-orange-100 text-orange-700",
  "Nivel V": "bg-rose-100 text-rose-700",
};

function getCourseInitials(name: string): string {
  return name
    .split(" ")
    .filter((w) => w.length > 3)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function isDataUri(src: string): boolean {
  return src.startsWith("data:");
}

export default function CourseCard({ course }: CourseCardProps) {
  const badgeClass =
    CATEGORY_COLORS[course.coursecategory] ?? "bg-slate-100 text-slate-600";

  return (
    <Link href={`/course/${course.id}`}>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:border-sky-300 transition-all overflow-hidden group cursor-pointer h-full flex flex-col">
        <div className="h-36 relative overflow-hidden">
          {course.courseimage && !isDataUri(course.courseimage) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={course.courseimage}
              alt={course.fullname}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-sky-600 to-cyan-500 flex items-center justify-center">
              <span className="text-4xl font-bold text-white/80">
                {getCourseInitials(course.fullname)}
              </span>
            </div>
          )}
        </div>

        <div className="p-4 flex flex-col flex-1">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full w-fit mb-2 ${badgeClass}`}>
            {course.coursecategory}
          </span>
          <h3 className="font-semibold text-slate-800 text-sm leading-snug line-clamp-2 flex-1">
            {course.fullname}
          </h3>
          <p className="text-xs text-slate-400 mt-2">{course.shortname}</p>
        </div>
      </div>
    </Link>
  );
}
