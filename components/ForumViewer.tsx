"use client";

import { useCallback, useState } from "react";
import Spinner from "@/components/Spinner";
import type { MoodleForumDiscussion, MoodleForumPost, MoodleModule } from "@/lib/moodle";
import { reportClientError } from "@/lib/clientErrorReporter";

function forumIdFromUrl(url?: string): string | null {
  if (!url) return null;
  return url.match(/[?&]id=(\d+)/)?.[1] ?? null;
}

function Avatar({ src, name, size }: { src?: string; name: string; size: number }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        style={{ width: size, height: size }}
        className="rounded-full shrink-0 object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-full flex items-center justify-center shrink-0 bg-[#e0f7ff] text-[#5ac8fa] font-bold text-[11px]"
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

// ─── DiscussionRow — a single discussion; expands inline into its posts ──────
function DiscussionRow({ discussion }: { discussion: MoodleForumDiscussion }) {
  const [open, setOpen] = useState(false);
  const [posts, setPosts] = useState<MoodleForumPost[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && !posts && !loading) {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/forum/discuss?id=${discussion.id}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "No se pudo abrir el debate");
        setPosts(j.posts as MoodleForumPost[]);
      } catch (e) {
        setError((e as Error).message);
        reportClientError("warning", `Carga de debate (${discussion.id}): ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    }
  }, [open, posts, loading, discussion.id]);

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] active:bg-[var(--surface2)] transition-colors text-left"
      >
        <Avatar src={discussion.authorAvatar} name={discussion.authorName} size={32} />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-medium text-[var(--fg)] truncate">{discussion.subject}</p>
          <p className="text-[12px] text-[var(--secondary)] truncate">
            {discussion.authorName} · {discussion.timeText}
            {discussion.locked ? " · Bloqueado" : ""}
          </p>
        </div>
        {discussion.replies > 0 && (
          <span className="text-[11px] font-semibold text-[var(--secondary)] bg-[var(--surface2)] rounded-full px-2 py-0.5 shrink-0">
            {discussion.replies}
          </span>
        )}
        <svg
          className={`w-4 h-4 text-[var(--secondary)] shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        >
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[rgba(60,60,67,0.06)] bg-[var(--surface2)]">
          {loading && (
            <div className="flex items-center justify-center gap-2.5 h-14">
              <Spinner size={16} color="#5ac8fa" />
              <span className="text-[12px] text-[var(--secondary)]">Cargando mensajes…</span>
            </div>
          )}

          {error && <div className="px-4 py-3 text-[13px] text-[#ff3b30]">{error}</div>}

          {posts && !loading && (
            <div className="divide-y divide-[rgba(60,60,67,0.06)]">
              {posts.map((post) => (
                <div key={post.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Avatar src={post.authorAvatar} name={post.authorName} size={22} />
                    <span className="text-[13px] font-semibold text-[var(--fg)]">{post.authorName}</span>
                    <span className="text-[11px] text-[var(--secondary)]">{post.timeText}</span>
                  </div>
                  <div
                    className="text-[13px] text-[var(--fg)] leading-relaxed break-words [overflow-wrap:anywhere] overflow-x-hidden
                      prose prose-sm max-w-none dark:prose-invert
                      prose-p:text-[var(--fg)] dark:prose-p:text-[var(--fg)] prose-p:my-1
                      prose-a:text-[var(--accent)] prose-a:no-underline hover:prose-a:underline
                      prose-strong:text-[var(--fg)] prose-strong:font-semibold
                      prose-ul:pl-4 prose-ol:pl-4 prose-li:text-[var(--fg)] dark:prose-li:text-[var(--fg)]"
                    dangerouslySetInnerHTML={{ __html: post.contentHtml }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ForumViewer — the forum module row + its expandable discussion list ─────
export default function ForumViewer({ mod }: { mod: MoodleModule }) {
  const [open, setOpen] = useState(false);
  const [discussions, setDiscussions] = useState<MoodleForumDiscussion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = forumIdFromUrl(mod.url);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && !discussions && !loading && id) {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/forum?id=${id}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "No se pudo abrir el foro");
        setDiscussions(j.discussions as MoodleForumDiscussion[]);
      } catch (e) {
        setError((e as Error).message);
        reportClientError("warning", `Carga de foro (${id}): ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    }
  }, [open, discussions, loading, id]);

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface2)] active:bg-[var(--surface2)] transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#e0f7ff", color: "#5ac8fa" }}>
          <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] text-[var(--fg)] truncate">{mod.name}</p>
        </div>
        <svg
          className={`w-4 h-4 text-[var(--secondary)] shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        >
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-[rgba(60,60,67,0.08)] bg-[var(--surface2)]">
          {loading && (
            <div className="flex items-center justify-center gap-2.5 h-16">
              <Spinner size={18} color="#5ac8fa" />
              <span className="text-[13px] text-[var(--secondary)]">Cargando avisos…</span>
            </div>
          )}

          {error && <div className="px-4 py-3 text-[13px] text-[#ff3b30]">{error}</div>}

          {discussions && !loading && (
            discussions.length === 0 ? (
              <p className="px-4 py-5 text-center text-[13px] text-[var(--secondary)]">Todavía no hay debates en este foro.</p>
            ) : (
              <div className="divide-y divide-[rgba(60,60,67,0.06)]">
                {discussions.map((d) => <DiscussionRow key={d.id} discussion={d} />)}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
