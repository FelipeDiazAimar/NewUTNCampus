"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Megaphone,
  Heart,
  MessageCircle,
  Send,
  Check,
  X,
  Trash2,
  Lock,
  VenetianMask,
  PartyPopper,
  Inbox,
  Loader2,
  AlertCircle,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";

// ─── Tipos (snake_case = columnas de Supabase) ────────────────────────────────

interface ForumComment {
  id: string;
  post_id: string;
  content: string;
  likes_count: number;
  created_at: string;
  // Solo cliente — no viene del servidor
  likedByMe?: boolean;
}

interface ForumPost {
  id: string;
  content: string;
  likes_count: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  foro_comments: ForumComment[];
  // Solo cliente — no viene del servidor
  likedByMe?: boolean;
}

type View = "community" | "review";

// ─── localStorage: likes anónimos ────────────────────────────────────────────

const LS_POSTS    = "foro_liked_posts";
const LS_COMMENTS = "foro_liked_comments";

function readLikedSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeLikedSet(key: string, set: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

// ─── Fetcher SWR ─────────────────────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Error al cargar el foro");
    return r.json() as Promise<ForumPost[]>;
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "Recién";
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `Hace ${d} ${d === 1 ? "día" : "días"}`;
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function TimeAgo({ iso }: { iso: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(timeAgo(iso));
    const id = setInterval(() => setLabel(timeAgo(iso)), 60_000);
    return () => clearInterval(id);
  }, [iso]);
  return <span suppressHydrationWarning>{label || " "}</span>;
}

function Avatar({ size = 36 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-white shadow-sm"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #ff9500, #ff3b30)",
      }}
    >
      <VenetianMask style={{ width: size * 0.5, height: size * 0.5 }} />
    </div>
  );
}

// ─── Segmented control ────────────────────────────────────────────────────────

function SegmentedControl({
  value,
  onChange,
  pendingCount,
}: {
  value: View;
  onChange: (v: View) => void;
  pendingCount: number;
}) {
  const tabs: { key: View; label: string; badge?: number }[] = [
    { key: "community", label: "Comunidad" },
    { key: "review", label: "Revisión", badge: pendingCount },
  ];

  return (
    <div className="mb-5 flex gap-1 rounded-[14px] bg-[var(--surface2)] p-1">
      {tabs.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[11px] py-2 text-[14px] font-semibold transition-all duration-300 ${
              active
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-sm"
                : "text-[var(--secondary)]"
            }`}
          >
            {t.label}
            {!!t.badge && t.badge > 0 && (
              <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-bold leading-none text-white">
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Píldora de acción ────────────────────────────────────────────────────────

function ActionPill({
  onClick,
  active,
  activeColor,
  Icon,
  count,
  filled,
  disabled,
}: {
  onClick: () => void;
  active: boolean;
  activeColor: string;
  Icon: React.ElementType;
  count: number;
  filled?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-300 active:scale-95 disabled:opacity-40"
      style={{
        background: active ? `${activeColor}1a` : "var(--surface2)",
        color: active ? activeColor : "var(--secondary)",
      }}
    >
      <Icon
        className="h-[15px] w-[15px] transition-transform duration-300"
        style={{ transform: active ? "scale(1.12)" : "scale(1)" }}
        fill={filled && active ? "currentColor" : "none"}
      />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

// ─── Composer de publicación ──────────────────────────────────────────────────

function PostComposer({
  onPublish,
  publishing,
}: {
  onPublish: (content: string) => Promise<void>;
  publishing: boolean;
}) {
  const [text, setText] = useState("");
  const canPublish = text.trim().length >= 10 && !publishing;

  async function submit() {
    if (!canPublish) return;
    await onPublish(text);
    setText("");
  }

  return (
    <div className="mb-5 rounded-3xl border border-[var(--separator)] bg-[var(--surface)] p-4 shadow-sm backdrop-blur-xl">
      <p className="mb-2 text-[13px] font-semibold text-[var(--fg)]">Nueva publicación</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Compartí una sugerencia, queja o aporte sobre la web o la facultad…"
        className="w-full resize-none rounded-2xl bg-[var(--surface2)] px-3.5 py-3 text-[15px] leading-relaxed text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--secondary)] focus:ring-2 focus:ring-[var(--accent)]/30"
      />
      <div className="mt-2.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--secondary)]">
          <Lock className="h-3.5 w-3.5" />
          100% anónimo
        </span>
        <button
          type="button"
          disabled={!canPublish}
          onClick={submit}
          className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2 text-[14px] font-semibold text-white transition-all duration-300 active:scale-95 disabled:opacity-40"
        >
          {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
          Publicar
        </button>
      </div>
      {text.trim().length > 0 && text.trim().length < 10 && (
        <p className="mt-1.5 text-[12px] text-[var(--secondary)]">
          Mínimo 10 caracteres ({text.trim().length}/10)
        </p>
      )}
    </div>
  );
}

// ─── Composer de respuesta ────────────────────────────────────────────────────

function ReplyComposer({
  onSubmit,
  submitting,
}: {
  onSubmit: (content: string) => Promise<void>;
  submitting: boolean;
}) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !submitting;

  async function submit() {
    if (!canSend) return;
    await onSubmit(text);
    setText("");
  }

  return (
    <div className="flex items-center gap-2 pt-1">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Escribí una respuesta…"
        className="flex-1 rounded-full bg-[var(--surface2)] px-4 py-2 text-[14px] text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--secondary)] focus:ring-2 focus:ring-[var(--accent)]/30"
      />
      <button
        type="button"
        disabled={!canSend}
        onClick={submit}
        aria-label="Enviar respuesta"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white transition-all duration-300 active:scale-90 disabled:opacity-40"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

// ─── Sub-comentario ───────────────────────────────────────────────────────────

function ReplyItem({
  reply,
  isAdmin,
  onLike,
  onDelete,
}: {
  reply: ForumComment;
  isAdmin: boolean;
  onLike: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Avatar size={28} />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-[var(--surface2)] px-3.5 py-2.5">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-[var(--fg)]">Anónimo</span>
            <span className="text-[11px] text-[var(--secondary)]">
              <TimeAgo iso={reply.created_at} />
            </span>
          </div>
          <p className="whitespace-pre-wrap text-[14px] leading-snug text-[var(--fg)]">
            {reply.content}
          </p>
        </div>
        <div className="mt-1 flex items-center gap-3 pl-1">
          <button
            type="button"
            onClick={onLike}
            className="flex items-center gap-1 text-[12px] font-semibold transition-colors duration-300"
            style={{ color: reply.likedByMe ? "#ff3b30" : "var(--secondary)" }}
          >
            <Heart
              className="h-[13px] w-[13px] transition-transform duration-300"
              style={{ transform: reply.likedByMe ? "scale(1.15)" : "scale(1)" }}
              fill={reply.likedByMe ? "currentColor" : "none"}
            />
            {reply.likes_count}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1 text-[12px] font-semibold text-[var(--secondary)] transition-colors duration-300 hover:text-[#ff3b30]"
            >
              <Trash2 className="h-[13px] w-[13px]" />
              Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tarjeta de publicación ───────────────────────────────────────────────────

function PostCard({
  post,
  isAdmin,
  mode,
  expanded,
  onToggleReplies,
  onLikePost,
  onAddReply,
  onLikeReply,
  onModerate,
  onDeletePost,
  onDeleteReply,
  moderating,
  deleting,
}: {
  post: ForumPost;
  isAdmin: boolean;
  mode: View;
  expanded: boolean;
  onToggleReplies: () => void;
  onLikePost: () => void;
  onAddReply: (content: string) => Promise<void>;
  onLikeReply: (replyId: string) => void;
  onModerate: (status: "approved" | "rejected") => void;
  onDeletePost: () => void;
  onDeleteReply: (replyId: string) => void;
  moderating: boolean;
  deleting: boolean;
}) {
  const [replySubmitting, setReplySubmitting] = useState(false);

  async function handleAddReply(content: string) {
    setReplySubmitting(true);
    await onAddReply(content);
    setReplySubmitting(false);
  }

  const sortedReplies = useMemo(
    () => [...post.foro_comments].sort((a, b) => b.likes_count - a.likes_count),
    [post.foro_comments]
  );

  return (
    <article className="overflow-hidden rounded-3xl border border-[var(--separator)] bg-[var(--surface)] shadow-sm backdrop-blur-xl transition-all duration-300">
      <div className="p-4 sm:p-5">
        {/* Cabecera */}
        <div className="mb-3 flex items-center gap-2.5">
          <Avatar size={36} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold leading-tight text-[var(--fg)]">Anónimo</p>
            <p className="text-[12px] text-[var(--secondary)]">
              <TimeAgo iso={post.created_at} />
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={onDeletePost}
              disabled={deleting}
              aria-label="Eliminar publicación"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--secondary)] transition-colors duration-300 hover:bg-[#ff3b30]/10 hover:text-[#ff3b30] disabled:opacity-40"
            >
              {deleting ? (
                <Loader2 className="h-[15px] w-[15px] animate-spin" />
              ) : (
                <Trash2 className="h-[17px] w-[17px]" />
              )}
            </button>
          )}
        </div>

        {/* Contenido */}
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--fg)]">
          {post.content}
        </p>

        {/* Acciones */}
        <div className="mt-4 flex items-center gap-2">
          {mode === "community" ? (
            <>
              <ActionPill
                onClick={onLikePost}
                active={!!post.likedByMe}
                activeColor="#ff3b30"
                Icon={Heart}
                count={post.likes_count}
                filled
              />
              <ActionPill
                onClick={onToggleReplies}
                active={expanded}
                activeColor="#007aff"
                Icon={MessageCircle}
                count={post.foro_comments.length}
              />
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={moderating}
                onClick={() => onModerate("approved")}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#34c759] py-2.5 text-[14px] font-semibold text-white transition-all duration-300 active:scale-95 disabled:opacity-50"
              >
                {moderating ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : <Check className="h-[17px] w-[17px]" />}
                Aprobar
              </button>
              <button
                type="button"
                disabled={moderating}
                onClick={() => onModerate("rejected")}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#ff3b30] py-2.5 text-[14px] font-semibold text-white transition-all duration-300 active:scale-95 disabled:opacity-50"
              >
                {moderating ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : <X className="h-[17px] w-[17px]" />}
                Rechazar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Acordeón de respuestas */}
      {mode === "community" && (
        <div
          className={`grid transition-all duration-300 ease-out ${
            expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="space-y-3 border-t border-[var(--separator)] px-4 py-4 sm:px-5">
              {sortedReplies.map((reply) => (
                <ReplyItem
                  key={reply.id}
                  reply={reply}
                  isAdmin={isAdmin}
                  onLike={() => onLikeReply(reply.id)}
                  onDelete={() => onDeleteReply(reply.id)}
                />
              ))}
              {sortedReplies.length === 0 && (
                <p className="py-1 text-center text-[13px] text-[var(--secondary)]">
                  Todavía no hay respuestas. ¡Sé el primero!
                </p>
              )}
              <ReplyComposer onSubmit={handleAddReply} submitting={replySubmitting} />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

// ─── Modal de agradecimiento ──────────────────────────────────────────────────

function ThanksAlert({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      role="dialog"
      aria-modal="true"
    >
      <button type="button" className="absolute inset-0" aria-label="Cerrar" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: "rgba(52,199,89,0.14)" }}
        >
          <PartyPopper className="h-7 w-7 text-[#34c759]" />
        </div>
        <h2 className="text-center text-[18px] font-bold text-[var(--fg)]">
          ¡Gracias por tu aporte!
        </h2>
        <p className="mt-2 text-center text-[14px] leading-relaxed text-[var(--secondary)]">
          Tu publicación será revisada por un bot para respetar las politicas de la comunidad y estará visible en un plazo de 24 horas.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-2xl bg-[var(--accent)] py-3 text-[15px] font-semibold text-white transition-all duration-300 active:scale-95"
        >
          Entendido
        </button>
      </div>
    </div>
  );
}

// ─── Página del foro ──────────────────────────────────────────────────────────

export default function ForoClient({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<View>("community");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showThanks, setShowThanks] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Liked state (anónimo, persiste en localStorage)
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());

  // Para indicadores de carga por acción (moderación, borrado)
  const [moderatingId, setModeratingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Autenticación ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) router.push("/");
  }, [router]);

  // ── Cargar liked state desde localStorage ───────────────────────────────────
  useEffect(() => {
    setLikedPosts(readLikedSet(LS_POSTS));
    setLikedComments(readLikedSet(LS_COMMENTS));
  }, []);

  // ── SWR: dos feeds paralelos para admin ─────────────────────────────────────
  const {
    data: rawApproved = [],
    error: approvedError,
    isLoading: loadingApproved,
    mutate: mutateApproved,
  } = useSWR<ForumPost[]>("/api/foro?view=approved", fetcher, {
    revalidateOnFocus: false,
  });

  const {
    data: rawPending = [],
    error: pendingError,
    isLoading: loadingPending,
    mutate: mutatePending,
  } = useSWR<ForumPost[]>(isAdmin ? "/api/foro?view=pending" : null, fetcher, {
    revalidateOnFocus: false,
  });

  // ── Enriquecer con liked state ───────────────────────────────────────────────
  const enrich = useCallback(
    (posts: ForumPost[]) =>
      posts.map((p) => ({
        ...p,
        likedByMe: likedPosts.has(p.id),
        foro_comments: p.foro_comments.map((c) => ({
          ...c,
          likedByMe: likedComments.has(c.id),
        })),
      })),
    [likedPosts, likedComments]
  );

  const approved = useMemo(() => enrich(rawApproved), [rawApproved, enrich]);
  const pending  = useMemo(() => enrich(rawPending),  [rawPending,  enrich]);

  const list    = view === "community" ? approved : pending;
  const loading = view === "community" ? loadingApproved : loadingPending;
  const error   = view === "community" ? approvedError : pendingError;

  // ── Acciones ─────────────────────────────────────────────────────────────────

  async function publish(content: string) {
    setPublishing(true);
    try {
      const res = await fetch("/api/foro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error();
      // El post nuevo es 'pending' — aparece en la bandeja del admin.
      await mutatePending();
      setShowThanks(true);
    } catch {
      // Podría mostrarse un toast; por ahora silencioso.
    } finally {
      setPublishing(false);
    }
  }

  function toggleLikePost(post: ForumPost) {
    const liked = likedPosts.has(post.id);
    const delta = liked ? -1 : 1;

    // Actualizar localStorage
    const next = new Set(likedPosts);
    liked ? next.delete(post.id) : next.add(post.id);
    setLikedPosts(next);
    writeLikedSet(LS_POSTS, next);

    // Optimistic: actualizar ambos caches localmente
    const patchPost = (posts: ForumPost[]) =>
      posts.map((p) =>
        p.id === post.id ? { ...p, likes_count: Math.max(0, p.likes_count + delta) } : p
      );
    mutateApproved(patchPost(rawApproved), false);

    // Llamada real al servidor (fire & forget — SWR revalida si falla)
    fetch(`/api/foro/${post.id}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta }),
    }).catch(() => mutateApproved());
  }

  function toggleReplies(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function addReply(postId: string, content: string) {
    const res = await fetch("/api/foro/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: postId, content }),
    });
    if (!res.ok) return;
    // Reinsertar en el feed para que el nuevo comentario aparezca
    await mutateApproved();
  }

  function toggleLikeReply(post: ForumPost, replyId: string) {
    const liked = likedComments.has(replyId);
    const delta = liked ? -1 : 1;

    const next = new Set(likedComments);
    liked ? next.delete(replyId) : next.add(replyId);
    setLikedComments(next);
    writeLikedSet(LS_COMMENTS, next);

    // Optimistic
    const patchComments = (posts: ForumPost[]) =>
      posts.map((p) =>
        p.id === post.id
          ? {
              ...p,
              foro_comments: p.foro_comments.map((c) =>
                c.id === replyId
                  ? { ...c, likes_count: Math.max(0, c.likes_count + delta) }
                  : c
              ),
            }
          : p
      );
    mutateApproved(patchComments(rawApproved), false);

    fetch(`/api/foro/comments/${replyId}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta }),
    }).catch(() => mutateApproved());
  }

  async function moderate(id: string, status: "approved" | "rejected") {
    setModeratingId(id);
    try {
      const res = await fetch(`/api/foro/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      await Promise.all([mutateApproved(), mutatePending()]);
    } finally {
      setModeratingId(null);
    }
  }

  async function deletePost(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/foro/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      await Promise.all([mutateApproved(), mutatePending()]);
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteReply(postId: string, replyId: string) {
    // Optimistic
    const patch = (posts: ForumPost[]) =>
      posts.map((p) =>
        p.id === postId
          ? { ...p, foro_comments: p.foro_comments.filter((c) => c.id !== replyId) }
          : p
      );
    mutateApproved(patch(rawApproved), false);

    const res = await fetch(`/api/foro/comments/${replyId}`, { method: "DELETE" });
    if (!res.ok) mutateApproved(); // revalidar si falló
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const inReview = isAdmin && view === "review";

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />

      <main className="mx-auto max-w-xl px-4 pt-12 pb-12">
        <Breadcrumb
          items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Foro" }]}
        />

        {/* Encabezado */}
        <div className="mb-5 flex items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
            style={{ background: "linear-gradient(135deg, #ff9500, #ff3b30)" }}
          >
            <Megaphone className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-[26px] font-bold leading-none tracking-tight text-[var(--fg)]">
              Foro
            </h1>
            <p className="mt-1 text-[14px] text-[var(--secondary)]">
              Comunidad anónima del campus
            </p>
          </div>
        </div>

        {/* Segmented control — solo admin */}
        {isAdmin && (
          <SegmentedControl
            value={view}
            onChange={setView}
            pendingCount={rawPending.length}
          />
        )}

        {/* Composer — solo en vista comunidad */}
        {!inReview && <PostComposer onPublish={publish} publishing={publishing} />}

        {/* Estados de carga y error */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--secondary)]" />
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center gap-3 rounded-3xl border border-[#ffcdd2] bg-[rgba(255,59,48,0.06)] p-4 text-[14px] text-[#ff3b30]">
            <AlertCircle className="h-5 w-5 shrink-0" />
            No se pudo cargar el foro. Intentá recargar la página.
          </div>
        )}

        {/* Listado */}
        {!loading && !error && (
          <div className="space-y-4">
            {list.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                isAdmin={isAdmin}
                mode={inReview ? "review" : "community"}
                expanded={!!expanded[post.id]}
                onToggleReplies={() => toggleReplies(post.id)}
                onLikePost={() => toggleLikePost(post)}
                onAddReply={(content) => addReply(post.id, content)}
                onLikeReply={(replyId) => toggleLikeReply(post, replyId)}
                onModerate={(status) => moderate(post.id, status)}
                onDeletePost={() => deletePost(post.id)}
                onDeleteReply={(replyId) => deleteReply(post.id, replyId)}
                moderating={moderatingId === post.id}
                deleting={deletingId === post.id}
              />
            ))}

            {list.length === 0 && (
              <div className="rounded-3xl border border-[var(--separator)] bg-[var(--surface)] px-4 py-12 text-center shadow-sm">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface2)]">
                  <Inbox className="h-6 w-6 text-[var(--secondary)]" />
                </div>
                <p className="text-[14px] text-[var(--secondary)]">
                  {inReview
                    ? "No hay publicaciones para revisar. ¡Todo al día! 🎉"
                    : "Todavía no hay publicaciones aprobadas."}
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      {showThanks && <ThanksAlert onClose={() => setShowThanks(false)} />}
    </div>
  );
}
