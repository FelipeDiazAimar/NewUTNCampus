"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { ArrowLeft, ArrowUp, Mail, MessageCircle, Search, X } from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
import ContactDetailSheet from "@/components/ContactDetailSheet";
import {
  avatarColor,
  formatChatTime,
  getInitials,
  type Conversation,
  type Message,
  type UserProfile,
} from "@/lib/chat";

// ─── Email helper ─────────────────────────────────────────────────────────────

function emailHref(email: string): string {
  if (typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return `mailto:${email}`;
  }
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type ConvResp = { conversations: Conversation[]; meId: number };
type MsgResp = { messages: Message[]; meId: number };
interface SearchUser { id: number; name: string; avatarUrl: string | null }
interface UserSearchResult { contacts: SearchUser[]; noncontacts: SearchUser[] }
interface PendingContact { id: number; name: string; avatarUrl: string | null }

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function jsonFetcher<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 401) throw Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "No se pudo cargar la mensajería.");
  return j as T;
}

// ─── Avatar (foto o iniciales) ────────────────────────────────────────────────

function isDefaultAvatar(url?: string | null): boolean {
  return !url || /\/theme\/image\.php\/[^?]*\/u\/f\d/.test(url);
}

function proxiedAvatar(url: string): string {
  return /frsfco\.cvg\.utn\.edu\.ar/.test(url)
    ? `/api/files?url=${encodeURIComponent(url)}&inline=1`
    : url;
}

function Avatar({ name, url, size = 52, online }: { name: string; url?: string | null; size?: number; online?: boolean }) {
  const showPhoto = !isDefaultAvatar(url);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={proxiedAvatar(url!)} alt={name} className="h-full w-full rounded-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
          style={{ backgroundColor: avatarColor(name), fontSize: size * 0.4 }}
        >
          {getInitials(name)}
        </div>
      )}
      {online && (
        <span
          className="absolute bottom-0 right-0 rounded-full border-2 border-[var(--surface)] bg-[#34c759]"
          style={{ width: size * 0.28, height: size * 0.28 }}
        />
      )}
    </div>
  );
}

// ─── Fila de conversación (panel izquierdo) ───────────────────────────────────

function ConversationRow({ conv, active, onClick }: { conv: Conversation; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
        active ? "bg-[var(--surface2)]" : "active:bg-[var(--surface2)] lg:hover:bg-[var(--surface2)]"
      }`}
    >
      <Avatar name={conv.contact.name} url={conv.contact.avatarUrl} online={conv.contact.online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-semibold text-[var(--fg)]">{conv.contact.name}</span>
          <span className="shrink-0 text-[12px] text-[var(--secondary)]">{formatChatTime(conv.lastTimestamp)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-[13px] ${conv.unread > 0 ? "font-medium text-[var(--fg)]" : "text-[var(--secondary)]"}`}>
            {conv.lastMessage}
          </span>
          {conv.unread > 0 && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#007aff]" />}
        </div>
      </div>
    </button>
  );
}

// ─── Fila de resultado de búsqueda (usuario del campus) ──────────────────────

function UserRow({ user, label, onClick }: { user: SearchUser; label?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-[var(--surface2)] lg:hover:bg-[var(--surface2)]"
    >
      <Avatar name={user.name} url={user.avatarUrl} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-[var(--fg)]">{user.name}</p>
        {label && <p className="text-[12px] text-[var(--secondary)]">{label}</p>}
      </div>
      <span className="shrink-0 rounded-full bg-[#007aff1a] px-2.5 py-1 text-[11px] font-semibold text-[#007aff]">
        Mensaje
      </span>
    </button>
  );
}

// ─── Burbuja de mensaje (panel derecho) ───────────────────────────────────────

function MessageBubble({ msg, mine }: { msg: Message; mine: boolean }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] px-3.5 py-2 text-[15px] leading-snug shadow-sm ${
          mine
            ? "rounded-2xl rounded-br-sm bg-[#007aff] text-white"
            : "rounded-2xl rounded-bl-sm bg-[var(--surface2)] text-[var(--fg)]"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
        <span className={`mt-1 block text-right text-[10.5px] ${mine ? "text-white/70" : "text-[var(--secondary)]"}`}>
          {formatChatTime(msg.timestamp)}
        </span>
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingContact, setPendingContact] = useState<PendingContact | null>(null);
  const [draft, setDraft] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  // Búsqueda de usuarios del campus (debounced)
  const [userSearchResult, setUserSearchResult] = useState<UserSearchResult | null>(null);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Cierra el sheet de perfil al cambiar de conversación
  const prevSelectedId = useRef<number | null>(null);
  useEffect(() => {
    if (selectedId !== prevSelectedId.current) {
      setProfileOpen(false);
      prevSelectedId.current = selectedId;
    }
  }, [selectedId]);

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) { router.replace("/"); return; }
    setAuthed(true);
  }, [router]);

  // Buscar usuarios del campus cuando el texto del buscador cambia
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const q = search.trim();
    if (q.length < 2) { setUserSearchResult(null); return; }
    searchTimerRef.current = setTimeout(async () => {
      setUserSearchLoading(true);
      try {
        const r = await fetch(`/api/chat/search-users?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (r.ok) setUserSearchResult(await r.json());
      } catch { /* ignore */ } finally {
        setUserSearchLoading(false);
      }
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [search]);

  const { data: convData, error: convError, isLoading: convLoading, mutate: mutateConvs } = useSWR(
    authed ? "/api/chat/conversations" : null,
    jsonFetcher<ConvResp>,
    { revalidateOnFocus: true, dedupingInterval: 20_000, refreshInterval: 30_000, keepPreviousData: true }
  );

  const { data: msgData, isLoading: msgLoading, mutate: mutateMsgs } = useSWR(
    authed && selectedId != null ? `/api/chat/messages?convid=${selectedId}` : null,
    jsonFetcher<MsgResp>,
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if ((convError as { status?: number } | undefined)?.status === 401) router.replace("/");
  }, [convError, router]);

  const conversations = useMemo(() => convData?.conversations ?? [], [convData]);
  const meId = convData?.meId ?? msgData?.meId ?? 0;
  const messages = useMemo(() => msgData?.messages ?? [], [msgData]);

  // Conversaciones filtradas por texto de búsqueda
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => c.contact.name.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  // Resultados de búsqueda de usuarios del campus — excluir los que ya son contactos con conv activa
  const existingContactIds = useMemo(() => new Set(conversations.map((c) => c.contact.id)), [conversations]);
  const campusContacts = useMemo(
    () => (userSearchResult?.contacts ?? []).filter((u) => !existingContactIds.has(u.id)),
    [userSearchResult, existingContactIds]
  );
  const campusNonContacts = useMemo(
    () => (userSearchResult?.noncontacts ?? []).filter((u) => !existingContactIds.has(u.id)),
    [userSearchResult, existingContactIds]
  );
  const hasCampusResults = campusContacts.length > 0 || campusNonContacts.length > 0;

  // El "panel activo": conversación existente o contacto pendiente (nuevo chat)
  const activeName = selected?.contact.name ?? pendingContact?.name ?? null;
  const activeAvatarUrl = selected?.contact.avatarUrl ?? pendingContact?.avatarUrl ?? null;
  const activeOnline = selected?.contact.online ?? false;
  const activeRole = selected?.contact.role ?? null;
  const isPanelOpen = selected != null || pendingContact != null;

  // Perfil del contacto activo (eager load)
  const profileContactId = selected?.contact.id ?? pendingContact?.id ?? null;
  const { data: profileData, isLoading: profileLoading } = useSWR(
    authed && profileContactId
      ? `/api/userprofile?userid=${profileContactId}`
      : null,
    jsonFetcher<UserProfile>,
    { revalidateOnFocus: false, dedupingInterval: 120_000 }
  );

  // Marcar como leído al abrir conversación existente
  useEffect(() => {
    if (selectedId == null) return;
    const conv = conversations.find((c) => c.id === selectedId);
    if (!conv || conv.unread === 0) return;
    mutateConvs(
      (prev) =>
        prev
          ? { ...prev, conversations: prev.conversations.map((c) => (c.id === selectedId ? { ...c, unread: 0 } : c)) }
          : prev,
      { revalidate: false }
    );
    fetch("/api/chat/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ convid: selectedId }),
    })
      .then(() => globalMutate("/api/chat/unread"))
      .catch(() => {});
  }, [selectedId, conversations, mutateConvs]);

  // Scroll automático al último mensaje
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedId, messages.length]);

  function openPendingContact(user: SearchUser) {
    // Si ya tenemos conversación con este usuario, abrirla directamente
    const existing = conversations.find((c) => c.contact.id === user.id);
    if (existing) {
      setSelectedId(existing.id);
      setPendingContact(null);
    } else {
      setSelectedId(null);
      setPendingContact({ id: user.id, name: user.name, avatarUrl: user.avatarUrl });
    }
    setSearch("");
    setUserSearchResult(null);
  }

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");

    if (pendingContact) {
      // Nuevo chat con no-contacto: enviar por touserid, luego buscar la conv creada
      try {
        await fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ touserid: pendingContact.id, text }),
        });
        const result = await mutateConvs();
        const newConv = result?.conversations.find((c) => c.contact.id === pendingContact.id);
        if (newConv) {
          setSelectedId(newConv.id);
          setPendingContact(null);
        }
      } catch (e) {
        console.error("[chat/send pending]", e);
      }
      return;
    }

    if (!selected || meId === 0) return;

    // Optimista: burbuja al instante
    const optimistic: Message = { id: Date.now(), fromId: meId, text, timestamp: Date.now() };
    mutateMsgs((prev) => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev), { revalidate: false });

    const body =
      selected.type === "individual" && selected.contact.id
        ? { touserid: selected.contact.id, text }
        : { convid: selected.id, text };
    try {
      await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } finally {
      mutateMsgs();
    }
  }

  function closePanel() {
    setSelectedId(null);
    setPendingContact(null);
  }

  if (!authed) {
    return (
      <div className="h-[100dvh] bg-[var(--bg)]">
        <Navbar />
      </div>
    );
  }

  const showSearch = search.trim().length >= 2;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[var(--bg)]">
      <Navbar />

      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col sm:px-4 sm:-mt-6 sm:pt-6 sm:pb-6">
        <div className="px-4 pt-1 sm:px-0">
          <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Chat" }]} />
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden bg-transparent sm:rounded-3xl sm:border sm:border-[var(--separator)] sm:bg-[var(--surface)] sm:shadow-sm">
          {/* ── Panel izquierdo: lista + búsqueda ── */}
          <aside
            className={`${isPanelOpen ? "hidden lg:flex" : "flex"} w-full shrink-0 flex-col border-[var(--separator)] lg:w-[360px] lg:border-r`}
          >
            <div className="px-4 pb-2 pt-4">
              <h1 className="mb-3 text-[24px] font-bold tracking-tight text-[var(--fg)]">Mensajes</h1>
              <div className="flex items-center gap-2 rounded-full bg-[var(--surface2)] px-3.5 py-2">
                <Search className="h-4 w-4 shrink-0 text-[var(--secondary)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar o nuevo mensaje"
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none"
                />
                {search && (
                  <button type="button" onClick={() => { setSearch(""); setUserSearchResult(null); }} className="shrink-0 text-[var(--secondary)] active:opacity-60">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              {!showSearch ? (
                /* Vista normal: lista de conversaciones */
                convLoading && !convData ? (
                  <SpinnerBlock label="Cargando chats…" />
                ) : convError ? (
                  <p className="px-4 py-10 text-center text-[14px] text-[#ff3b30]">No se pudieron cargar los chats.</p>
                ) : conversations.length === 0 ? (
                  <p className="px-4 py-10 text-center text-[14px] text-[var(--secondary)]">No tenés mensajes todavía.</p>
                ) : (
                  conversations.map((c) => (
                    <ConversationRow
                      key={c.id}
                      conv={c}
                      active={c.id === selectedId}
                      onClick={() => { setSelectedId(c.id); setPendingContact(null); }}
                    />
                  ))
                )
              ) : (
                /* Vista de búsqueda */
                <>
                  {/* Conversaciones existentes que coinciden */}
                  {filtered.length > 0 && (
                    <>
                      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--secondary)]">
                        Conversaciones
                      </p>
                      {filtered.map((c) => (
                        <ConversationRow
                          key={c.id}
                          conv={c}
                          active={c.id === selectedId}
                          onClick={() => { setSelectedId(c.id); setPendingContact(null); setSearch(""); setUserSearchResult(null); }}
                        />
                      ))}
                    </>
                  )}

                  {/* Usuarios del campus */}
                  {userSearchLoading && (
                    <div className="flex items-center gap-2 px-4 py-3 text-[13px] text-[var(--secondary)]">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--secondary)] border-t-transparent" />
                      Buscando en el campus…
                    </div>
                  )}

                  {!userSearchLoading && hasCampusResults && (
                    <>
                      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--secondary)]">
                        Usuarios del campus
                      </p>
                      {campusContacts.map((u) => (
                        <UserRow key={u.id} user={u} label="Contacto" onClick={() => openPendingContact(u)} />
                      ))}
                      {campusNonContacts.map((u) => (
                        <UserRow key={u.id} user={u} onClick={() => openPendingContact(u)} />
                      ))}
                    </>
                  )}

                  {!userSearchLoading && !hasCampusResults && filtered.length === 0 && (
                    <p className="px-4 py-10 text-center text-[14px] text-[var(--secondary)]">Sin resultados.</p>
                  )}
                </>
              )}
            </div>
          </aside>

          {/* ── Panel derecho: chat activo ── */}
          <section className={`${isPanelOpen ? "flex" : "hidden lg:flex"} min-w-0 flex-1 flex-col bg-[var(--bg)]`}>
            {isPanelOpen && activeName ? (
              <>
                {/* Cabecera glass fija */}
                <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--separator)] bg-[var(--bg)]/80 px-3 py-2.5 backdrop-blur-md">
                  <button
                    type="button"
                    onClick={closePanel}
                    className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-[var(--accent)] active:bg-[var(--surface2)] lg:hidden"
                    aria-label="Volver"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => selected && setProfileOpen(true)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left transition-opacity active:opacity-70"
                    aria-label={`Ver perfil de ${activeName}`}
                  >
                    <Avatar name={activeName} url={activeAvatarUrl} size={40} online={activeOnline} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-[var(--fg)]">{activeName}</p>
                      <p className="truncate text-[12px] text-[var(--secondary)]">
                        {pendingContact
                          ? "Nuevo chat"
                          : activeOnline ? "Conectado" : activeRole ?? "Desconectado"}
                      </p>
                    </div>
                  </button>

                  {profileData?.email && (
                    <a
                      href={emailHref(profileData.email)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#007aff] transition-opacity hover:opacity-80 active:opacity-60"
                      aria-label={`Enviar correo a ${activeName}`}
                    >
                      <Mail className="h-5 w-5" />
                    </a>
                  )}
                </header>

                {/* Mensajes */}
                <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
                  {pendingContact ? (
                    <p className="py-10 text-center text-[14px] text-[var(--secondary)]">
                      Escribí el primer mensaje para iniciar la conversación.
                    </p>
                  ) : msgLoading && messages.length === 0 ? (
                    <SpinnerBlock label="Cargando mensajes…" />
                  ) : messages.length === 0 ? (
                    <p className="py-10 text-center text-[14px] text-[var(--secondary)]">No hay mensajes. ¡Escribí el primero!</p>
                  ) : (
                    messages.map((m) => <MessageBubble key={m.id} msg={m} mine={m.fromId === meId} />)
                  )}
                </div>

                {/* Input */}
                <div className="border-t border-[var(--separator)] bg-[var(--bg)]/80 px-3 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] backdrop-blur-md">
                  <div className="flex items-end gap-2">
                    <div className="flex min-h-[40px] flex-1 items-center rounded-full bg-[var(--surface2)] px-4 py-2">
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                        placeholder="Mensaje…"
                        className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={send}
                      disabled={!draft.trim()}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#007aff] text-white shadow-sm transition-opacity active:opacity-80 disabled:opacity-40"
                      aria-label="Enviar"
                    >
                      <ArrowUp className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              // Estado vacío (solo visible en desktop, sin chat seleccionado)
              <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-center lg:flex">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--surface2)]">
                  <MessageCircle className="h-8 w-8 text-[var(--secondary)]" />
                </div>
                <p className="text-[16px] font-semibold text-[var(--fg)]">Tus mensajes</p>
                <p className="max-w-xs text-[14px] text-[var(--secondary)]">
                  Elegí una conversación o buscá un usuario para empezar a chatear.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Sheet de perfil */}
      {selected && (
        <ContactDetailSheet
          contact={selected.contact}
          profile={profileData ?? null}
          loading={profileLoading}
          isOpen={profileOpen}
          onClose={() => setProfileOpen(false)}
        />
      )}
    </div>
  );
}
