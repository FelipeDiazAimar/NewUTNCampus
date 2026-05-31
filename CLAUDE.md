# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Production build
npm run lint     # Run ESLint
```

No test suite is configured.

## Architecture

Campus UTN is a Next.js App Router frontend that wraps UTN FRSF's Moodle instance (`https://frsfco.cvg.utn.edu.ar`) with a mobile-style iOS-inspired UI.

### Auth flow

`lib/moodle.ts:moodleLogin` performs a 3-step scrape-based login:
1. Fetch the Moodle login page to extract a `logintoken` and pre-session cookie (both needed together for CSRF validation)
2. POST credentials with pre-session; capture the `MoodleSession` cookie; follow any `testsession=` redirect
3. Fetch `/my/courses.php` to scrape `sesskey`, `userid`, and `fullname` from embedded JSON (session may regenerate here — always use the latest token)

On success, `DELETE /api/auth` (POST) sets three cookies: `moodle_session_token` and `moodle_sesskey` (httpOnly, store the raw token without the `MoodleSession=` prefix) and `moodle_user` (client-readable JSON with userid/fullname/username). `DELETE /api/auth` clears all three. Client pages check `document.cookie` for `moodle_user` to gate navigation.

### API proxy pattern

All Moodle AJAX calls from the browser go through `/api/moodle` (POST), which reads the httpOnly session cookies and forwards to Moodle's `lib/ajax/service.php`. Body shape: `{ methodname: string, args: object }`.

Additional server-side API routes:

| Route | Method | Purpose |
|---|---|---|
| `/api/files?url=...` | GET | Streams a Moodle file with session cookie auth |
| `/api/course?id=N` | GET | Scrapes course page HTML to build section/module list |
| `/api/meta?url=...` | GET | HEAD-follows to final URL; returns `{ contentType, filename }` |
| `/api/convert?url=...&filename=...` | GET | Downloads and converts DOCX/XLSX/PPTX/CSV for in-browser preview |

`/api/convert` uses `mammoth` (DOCX→HTML), `xlsx` (spreadsheets→HTML table), and `jszip` (PPTX→slide paragraphs). Returns a discriminated union `ConvertResult` with `kind` field.

### Data hooks

`lib/hooks.ts` exports `useCourses()` and `useCourseContents(courseId)` — React hooks that return `{ data, loading, error }`.

- `useCourses()` calls `POST /api/moodle` with `core_course_get_enrolled_courses_by_timeline_classification`
- `useCourseContents(courseId)` calls `GET /api/course` (scrape-based) — `core_course_get_contents` is blocked on this Moodle instance (`servicenotavailable`)

### Routing

| Route | File | Notes |
|---|---|---|
| `/` | `app/page.tsx` | Login form; redirects to `/dashboard` if already authenticated |
| `/dashboard` | `app/dashboard/page.tsx` | Course list with search |
| `/course/[id]` | `app/course/[id]/page.tsx` | Section accordion with file downloads |

### Styling

Tailwind CSS v4 with an iOS HIG design language: `#007aff` accent, `#1c1c1e` text, `#f2f2f7` background, Apple system font stack. CSS variables are defined in `app/globals.css`. All color values are used as inline hex literals in JSX, not via Tailwind color tokens.

### Path alias

`@/*` maps to the project root (e.g., `@/lib/moodle`, `@/components/Navbar`).
