"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { useCourseContents } from "@/lib/hooks";
import type { MoodleModule } from "@/lib/moodle";
import WorkspaceLayout, { usePdfPreview } from "@/components/CourseWorkspaceLayout";
import Breadcrumb from "@/components/Breadcrumb";
import parse from "html-react-parser";
import type { Element } from "domhandler";
import Spinner, { SpinnerBlock } from "@/components/Spinner";
import FolderViewer from "@/components/FolderViewer";
import H5pViewer from "@/components/H5pViewer";
import { FileViewer } from "@/components/CourseFileViewer";

const MOODLE_BASE = "https://frsfco.cvg.utn.edu.ar";

function getUserInfo() {
  if (typeof document === "undefined") return {};
  const m = document.cookie.match(/moodle_user=([^;]+)/);
  if (!m) return {};
  try { return JSON.parse(decodeURIComponent(m[1])); } catch { return {}; }
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const MOD_COLORS: Record<string, [string, string]> = {
  resource: ["#007aff", "#e8f4fd"],
  folder:   ["#ff9500", "#fff3e0"],
  assign:   ["#34c759", "#e8f8ed"],
  forum:    ["#5ac8fa", "#e0f7ff"],
  quiz:     ["#af52de", "#f3e8ff"],
  url:      ["#ff2d55", "#ffe8ed"],
  page:     ["#8e8e93", "#f2f2f7"],
};

const MOD_LABELS: Record<string, string> = {
  resource:        "ARCH",
  folder:          "CARP",
  assign:          "Tarea",
  forum:           "Foro",
  quiz:            "Quiz",
  url:             "URL",
  page:            "Pág",
  workshop:        "Tall",
  wiki:            "Wiki",
  glossary:        "Glos",
  choice:          "Enc",
  survey:          "Enc",
  scorm:           "SCORM",
  h5pactivity:     "H5P",
  collaborate:     "Cola",
  bigbluebuttonbn: "BBB",
  videotime:       "Video",
  hvp:             "H5P",
  lti:             "LTI",
};

function getModBadge(mod: MoodleModule): string {
  const content = mod.contents?.[0];
  // 1. Prefer fileType extracted from Moodle icon (always accurate)
  if (content?.fileType) return content.fileType.slice(0, 4);
  // 2. Use filename extension only if it looks like a real one (2-5 alphanum chars)
  if (content?.filename) {
    const parts = content.filename.split(".");
    if (parts.length > 1) {
      const ext = parts.pop()?.toUpperCase() ?? "";
      if (/^[A-Z0-9]{2,5}$/.test(ext)) return ext.slice(0, 4);
    }
  }
  return MOD_LABELS[mod.modname] ?? mod.modname.slice(0, 4).toUpperCase();
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&amp;|&quot;|&#39;|&lt;|&gt;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>(?:\s*<\/script>)?/gi, "")
    .replace(/\sstyle=("[^"]*"|'[^']*')/gi, (match) => {
      const cleaned = match
        .replace(/color\s*:\s*[^;"']+;?/gi, "")
        .replace(/\s{2,}/g, " ");
      return cleaned === " style=\"\"" || cleaned === " style=''" ? "" : cleaned;
    });
}

/** Route Moodle-protected images (pluginfile.php) through the authenticated
 *  proxy so the session cookie is attached; leave external images untouched. */
function proxyImageSrc(src?: string): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("/api/")) return src; // already proxied
  let abs = src;
  if (src.startsWith("//")) abs = `https:${src}`;
  else if (src.startsWith("/")) abs = `${MOODLE_BASE}${src}`;
  if (abs.includes("pluginfile.php") || abs.includes("frsfco.cvg.utn.edu.ar")) {
    return `/api/files?url=${encodeURIComponent(abs)}&inline=1`;
  }
  return abs;
}

function safeParseHtml(html: string) {
  return parse(sanitizeHtml(html), {
    replace: (node) => {
      const el = node as Element;
      if (el?.type === "script" || el?.name === "script") return null;
      // Intercept <img>: proxy protected URLs and apply iOS-friendly styling.
      if (el?.name === "img") {
        const src = proxyImageSrc(el.attribs?.src);
        if (!src) return <></>;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={el.attribs?.alt ?? ""}
            loading="lazy"
            className="max-w-full h-auto object-contain rounded-xl my-2 mx-auto block shadow-sm"
          />
        );
      }
      return undefined;
    },
  });
}

function moduleSearchText(mod: MoodleModule) {
  const contentNames = mod.contents?.map((c) => `${c.filename} ${c.fileType ?? ""}`).join(" ") ?? "";
  return [mod.name, mod.description ?? "", contentNames].join(" ");
}

// ─── UrlModuleRow — resolves external URL on tap ──────────────────────────────

function UrlModuleRow({ mod }: { mod: MoodleModule }) {
  const [resolving, setResolving] = useState(false);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);

  async function handleOpen() {
    if (externalUrl) { window.open(externalUrl, "_blank", "noopener,noreferrer"); return; }
    if (!mod.url) return;
    setResolving(true);
    try {
      const r = await fetch(`/api/resolve?url=${encodeURIComponent(mod.url)}`);
      const { url } = await r.json();
      setExternalUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      window.open(mod.url, "_blank", "noopener,noreferrer");
    } finally {
      setResolving(false);
    }
  }

  return (
    <button
      onClick={handleOpen}
      disabled={resolving}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] active:bg-[var(--surface2)] transition-colors text-left"
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#ffe8ed", color: "#ff2d55" }}>
        {resolving ? (
          <Spinner size={18} color="#ff2d55" />
        ) : (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] text-[var(--fg)] truncate">{mod.name}</p>
        {externalUrl && <p className="text-[11px] text-[var(--secondary)] truncate">{externalUrl}</p>}
      </div>
      <svg className="w-4 h-4 text-[var(--secondary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
    </button>
  );
}

// ─── AssignModuleRow — shows assignment details inline ─────────────────────────

function AssignModuleRow({ mod }: { mod: MoodleModule }) {
  const { openAssignment, activeAssignmentKey } = usePdfPreview();
  const isActive = !!mod.url && activeAssignmentKey === mod.url;

  return (
    <button
      onClick={() => mod.url && openAssignment({ url: mod.url, name: mod.name, key: mod.url })}
      className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${
        isActive ? "bg-[var(--surface2)]" : "hover:bg-[var(--surface2)] active:bg-[var(--surface2)]"
      }`}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-bold"
        style={{ background: "#34c75922", color: "#34c759", fontSize: "7px" }}
      >
        Tarea
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] text-[var(--fg)] truncate">{mod.name}</p>
      </div>
      <svg
        className={`w-4 h-4 shrink-0 transition-transform ${isActive ? "rotate-90 text-[var(--accent)]" : "text-[var(--secondary)]"}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        <polyline points="9,18 15,12 9,6" />
      </svg>
    </button>
  );
}

// ─── ModuleRow ────────────────────────────────────────────────────────────────

function ModuleRow({ mod }: { mod: MoodleModule }) {
  const [open, setOpen] = useState(false);

  if (mod.modname === "label") {
    if (mod.description) {
      // Skip labels that only contain links and no real body text.
      // e.g. institutional navigation labels: <a href="...">RIA</a>
      const textOnly = mod.description.replace(/<a[\s\S]*?<\/a>/gi, "").replace(/<[^>]+>/g, "").trim();
      if (!textOnly) return null;

      return (
        <div
          className="px-4 py-3 text-[13px] text-[var(--fg)] leading-relaxed label-content"
        >
          {safeParseHtml(mod.description)}
        </div>
      );
    }
    return (
      <div className="px-4 py-2 text-[13px] text-[var(--secondary)] italic">
        {mod.name}
      </div>
    );
  }

  // Assignment → show details inline
  if (mod.modname === "assign") {
    return <AssignModuleRow mod={mod} />;
  }

  // Folder → expand an iOS accordion that lazy-loads the folder's inner files
  // instead of trying to download the folder module itself.
  if (mod.modname === "folder") {
    return <FolderViewer mod={mod} />;
  }

  // H5P → render the interactive player inline (proxied + authenticated) instead
  // of sending the user out to the Moodle page.
  if (mod.modname === "h5pactivity" || mod.modname === "hvp") {
    return <H5pViewer mod={mod} />;
  }

  // URL-type content → resolve external URL and open in new tab
  if (mod.contents?.[0]?.type === "url") {
    return <UrlModuleRow mod={mod} />;
  }

  const [color, bg] = MOD_COLORS[mod.modname] ?? ["#8e8e93", "#f2f2f7"];
  const hasFiles = (mod.contents?.length ?? 0) > 0;
  const isPreviewable = hasFiles && mod.modname === "resource";
  const badge = getModBadge(mod);
  const badgeFontSize = badge.length >= 5 ? "7px" : badge.length === 4 ? "9px" : "11px";

  return (
    <div>
      <button
        onClick={() => {
          if (isPreviewable) setOpen((o) => !o);
          else if (mod.url) window.open(mod.url, "_blank", "noopener,noreferrer");
        }}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] active:bg-[var(--surface2)] transition-colors text-left"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-bold"
          style={{ background: bg, color, fontSize: badgeFontSize }}
        >
          {badge}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] text-[var(--fg)] truncate">{mod.name}</p>
        </div>
        {(isPreviewable || mod.url) && (
          <svg
            className={`w-4 h-4 text-[var(--secondary)] shrink-0 transition-transform ${isPreviewable && open ? "rotate-90" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          >
            <polyline points="9,18 15,12 9,6" />
          </svg>
        )}
      </button>

      {isPreviewable && open && (
        <div className="border-t border-[rgba(60,60,67,0.08)] bg-[var(--surface2)] divide-y divide-[rgba(60,60,67,0.06)]">
          {mod.contents!.map((c, i) => <FileViewer key={i} content={c} />)}
        </div>
      )}
    </div>
  );
}

// ─── SectionAccordion ─────────────────────────────────────────────────────────

// Institutional navigation links added automatically to all UTN courses — never useful to students.
const INSTITUTIONAL_LINKS = new Set(["RIA", "eLibro", "Biblioteca", "Estudiantes", "Docentes"]);
const isVisible = (m: MoodleModule) => m.visible !== 0 && !INSTITUTIONAL_LINKS.has(m.name);

// ─── Subsection detection ──────────────────────────────────────────────────────
// Teachers commonly use a Label as a sub-heading to group the resources that
// follow it. Detect those "header labels" so we can render the modules beneath
// them as an indented subsection.
function headerLabelText(mod: MoodleModule): string | null {
  if (mod.modname !== "label" || !mod.description) return null;
  const html = mod.description;
  // Labels with links or images are real content, not headers.
  if (/<a\b|<img\b/i.test(html)) return null;
  const text = stripHtml(html).trim();
  if (!text || text.length > 70) return null;
  // An explicit heading element is the clearest signal of intent.
  if (/<h[1-6]\b/i.test(html)) return text;
  // …or a single short line that is entirely bold.
  const stripped = html.replace(/<\/?(p|div|br|span)[^>]*>/gi, "").trim();
  if (/^(<strong>|<b>)[\s\S]*(<\/strong>|<\/b>)$/i.test(stripped) && text.split(/\s+/).length <= 10) {
    return text;
  }
  return null;
}

type RenderGroup =
  | { kind: "loose"; mods: MoodleModule[] }
  | { kind: "subsection"; title: string; mods: MoodleModule[] };

/** Split a section's modules into loose top-level items and indented subsections. */
function groupModules(mods: MoodleModule[]): RenderGroup[] {
  const groups: RenderGroup[] = [{ kind: "loose", mods: [] }];
  for (const mod of mods) {
    const header = headerLabelText(mod);
    if (header) {
      groups.push({ kind: "subsection", title: header, mods: [] });
    } else {
      groups[groups.length - 1].mods.push(mod);
    }
  }
  // Drop the leading loose group if it ended up empty.
  return groups.filter((g) => g.mods.length > 0 || g.kind === "subsection");
}

/** Renders a section's module list, with label-headers becoming indented subsections. */
function SectionModules({ mods }: { mods: MoodleModule[] }) {
  const groups = groupModules(mods);
  return (
    <>
      {groups.map((group, i) =>
        group.kind === "loose" ? (
          <div key={`loose-${i}`} className="divide-y divide-[rgba(60,60,67,0.06)]">
            {group.mods.map((mod) => <ModuleRow key={mod.id} mod={mod} />)}
          </div>
        ) : (
          <div key={`sub-${i}`} className="border-t border-[var(--separator)]">
            <p className="px-4 pt-3 pb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--secondary)]">
              {group.title}
            </p>
            <div className="ml-4 pl-4 border-l-2 border-[var(--separator)] divide-y divide-[rgba(60,60,67,0.06)]">
              {group.mods.length > 0 ? (
                group.mods.map((mod) => <ModuleRow key={mod.id} mod={mod} />)
              ) : (
                <p className="px-4 py-3 text-[13px] text-[var(--secondary)] italic">Sin elementos</p>
              )}
            </div>
          </div>
        )
      )}
    </>
  );
}

function SectionAccordion({ section, defaultOpen }: {
  section: { id: number; name: string; summaryHtml?: string; modules: MoodleModule[] };
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const visibleMods = section.modules.filter((m) => isVisible(m) && m.modname !== "label");

  return (
    <div className="bg-[var(--surface)] rounded-2xl overflow-hidden shadow-sm w-full">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-start justify-between gap-3 px-4 py-4 text-left hover:bg-[var(--surface2)] transition-colors">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold text-[var(--fg)] leading-snug break-words whitespace-normal">
            {section.name || "General"}
          </p>
          <p className="text-[12px] text-[var(--secondary)] mt-0.5">{visibleMods.length} elemento{visibleMods.length !== 1 ? "s" : ""}</p>
        </div>
        <svg className={`w-5 h-5 text-[var(--secondary)] transition-transform mt-0.5 shrink-0 ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <polyline points="6,9 12,15 18,9" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-[rgba(60,60,67,0.1)]">
          {section.summaryHtml && (
            <div
              className="prose prose-sm max-w-none dark:prose-invert px-4 py-3 border-b border-[var(--separator)]
                prose-p:text-[var(--fg)] dark:prose-p:text-[var(--fg)] prose-p:leading-relaxed prose-p:my-1
                prose-a:text-[var(--accent)] prose-a:no-underline hover:prose-a:underline
                prose-strong:text-[var(--fg)] prose-strong:font-semibold
                prose-ul:pl-4 prose-ol:pl-4 prose-li:text-[var(--fg)] dark:prose-li:text-[var(--fg)] prose-li:my-0.5
                prose-headings:text-[var(--fg)] dark:prose-headings:text-[var(--fg)] prose-headings:font-semibold
                prose-img:rounded-lg prose-img:my-2"
              style={{ background: "var(--surface2)" }}
            >
              {safeParseHtml(section.summaryHtml)}
            </div>
          )}
          <SectionModules mods={section.modules.filter(isVisible)} />
        </div>
      )}
    </div>
  );
}

// ─── CoursePage ───────────────────────────────────────────────────────────────

export default function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { sections, courseName, loading, error } = useCourseContents(parseInt(id));
  const [userInfo, setUserInfo] = useState<{ fullname?: string }>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    setUserInfo(getUserInfo());
    if (!document.cookie.includes("moodle_user")) router.push("/");
  }, [router]);

  const visible = sections.filter((s) => s.visible !== 0 && s.modules.length > 0);
  const searchTerm = normalizeText(search);
  const filtered = searchTerm
    ? visible.filter((section) => {
        const summary = section.summaryHtml ? stripHtml(section.summaryHtml) : "";
        const moduleText = section.modules.map(moduleSearchText).join(" ");
        const haystack = normalizeText([section.name, summary, moduleText].join(" "));
        return haystack.includes(searchTerm);
      })
    : visible;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar fullname={userInfo.fullname} />
      {/*
        WorkspaceLayout manages the split-panel. It provides PdfPreviewContext
        so any FileViewer nested inside can push PDFs to the right panel.
        It also handles max-width: single-column uses max-w-2xl centred,
        split mode expands to max-w-[1600px].
      */}
      <WorkspaceLayout>
        <div className="pt-6 pb-6">
          {/* Breadcrumb */}
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Materias", href: "/materias" },
            ]}
          />

          {/* Course header — iOS Large Title style */}
          {(courseName || loading) && (
            <div style={{ marginBottom: "24px" }}>
              {loading && !courseName ? (
                <div className="space-y-2">
                  <div className="h-3 w-16 bg-[#e5e5ea] rounded animate-pulse" />
                  <div className="h-8 w-3/4 bg-[#e5e5ea] rounded-lg animate-pulse" />
                </div>
              ) : (
                <>
                  <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: "4px" }}>
                    Materia
                  </p>
                  <h1 style={{ fontSize: "clamp(22px, 5vw, 30px)", fontWeight: "800", color: "var(--fg)", lineHeight: "1.1", letterSpacing: "-0.5px", margin: 0 }}>
                    {courseName}
                  </h1>
                  {!loading && (
                    <p style={{ fontSize: "13px", color: "var(--secondary)", marginTop: "6px" }}>
                      {filtered.length} sección{filtered.length !== 1 ? "es" : ""}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Search */}
          {!loading && (
            <div className="relative mb-4">
              <svg
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--secondary)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar en esta materia…"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--separator)] text-[15px] text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none focus:border-[var(--accent)] transition-colors shadow-sm"
              />
            </div>
          )}

          {loading && (
            <div className="bg-[var(--surface)] rounded-2xl shadow-sm overflow-hidden w-full">
              <SpinnerBlock label="Cargando secciones…" size={30} minHeight={200} />
            </div>
          )}
          {error && <div className="bg-[#fff2f2] border border-[#ffcdd2] rounded-2xl p-5 text-[#ff3b30] text-sm">{error}</div>}
          {!loading && !error && (
            <div className="space-y-3 w-full">
              {filtered.map((s, i) => <SectionAccordion key={s.id} section={s} defaultOpen={i === 0} />)}
              {filtered.length === 0 && (
                <p className="text-center py-16 text-[var(--secondary)] text-[15px]">
                  {searchTerm ? "Sin resultados para esa busqueda." : "Sin contenido visible todavia."}
                </p>
              )}
            </div>
          )}
        </div>
      </WorkspaceLayout>
    </div>
  );
}
