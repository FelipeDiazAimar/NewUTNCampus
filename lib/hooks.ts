"use client";

import { useState, useEffect, useCallback } from "react";
import type { MoodleCourse, MoodleCourseSection } from "./moodle";

export function useCourses() {
  const [courses, setCourses] = useState<MoodleCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/moodle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          methodname:
            "core_course_get_enrolled_courses_by_timeline_classification",
          args: {
            offset: 0,
            limit: 0,
            classification: "all",
            customfieldname: "",
            customfieldvalue: "",
            searchvalue: "",
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setCourses(json.data.courses ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  return { courses, loading, error, refetch: fetch_ };
}

export function useCourseContents(courseId: number) {
  const [sections, setSections] = useState<MoodleCourseSection[]>([]);
  const [courseName, setCourseName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    setLoading(true);
    setError(null);
    // core_course_get_contents is blocked on this Moodle instance (servicenotavailable).
    // Scrape the course page directly instead.
    fetch(`/api/course?id=${courseId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setSections(Array.isArray(json.data) ? json.data : []);
        setCourseName(json.courseName ?? "");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [courseId]);

  return { sections, courseName, loading, error };
}
