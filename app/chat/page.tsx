"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { ArrowLeft, ArrowUp, MessageCircle, Search } from "lucide-react";
import Navbar from "@/components/Navbar";
import Breadcrumb from "@/components/Breadcrumb";
import { SpinnerBlock } from "@/components/Spinner";
import {
  avatarColor,
  formatChatTime,
  getInitials,
  type Conversation,
  type Message,
} from "@/lib/chat";

// ─── Fetchers ─────────────────────────────────────────────────────────────────

type ConvResp = { conversations: Conversation[]; meId: number };
type MsgResp = { messages: Message[]; meId: number };

async function jsonFetcher<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 401) throw Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "No se pudo cargar la mensajería.");
  return j as T;
}

// ─── Avatar (foto o iniciales) ────────────────────────────────────────────────

/** Avatar default de Moodle (silueta gris): preferimos iniciales antes que eso. */
function isDefaultAvatar(url?: string | null): boolean {
  return !url || /\/theme\/image\.php\/[^?]*\/u\/f\d/.test(url);
}

/** Las fotos reales viven en frsfco (con sesión) → las servimos por el proxy. */
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
  const [draft, setDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!document.cookie.includes("moodle_user")) { router.replace("/"); return; }
    setAuthed(true);
  }, [router]);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => c.contact.name.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  // Al abrir un chat con no leídos: marcarlo como leído (optimista) y avisar al server.
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
      .then(() => globalMutate("/api/chat/unread")) // refresca el badge del Navbar
      .catch(() => {});
  }, [selectedId, conversations, mutateConvs]);

  // Scroll automático al último mensaje cuando se abre o cambia el hilo.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedId, messages.length]);

  async function send() {
    const text = draft.trim();
    if (!text || !selected || meId === 0) return;
    setDraft("");

    // Optimista: la burbuja aparece al instante; luego revalidamos contra el server.
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

  if (!authed) {
    return (
      <div className="h-[100dvh] bg-[var(--bg)]">
        <Navbar />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[var(--bg)]">
      <Navbar />

      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col sm:px-4 sm:pb-4">
        <div className="px-4 pt-1 sm:px-0">
          <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Chat" }]} />
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden bg-transparent sm:rounded-3xl sm:border sm:border-[var(--separator)] sm:bg-[var(--surface)] sm:shadow-sm">
          {/* ── Panel izquierdo: lista ── */}
          <aside
            className={`${selectedId != null ? "hidden lg:flex" : "flex"} w-full shrink-0 flex-col border-[var(--separator)] lg:w-[360px] lg:border-r`}
          >
            <div className="px-4 pb-2 pt-4">
              <h1 className="mb-3 text-[24px] font-bold tracking-tight text-[var(--fg)]">Mensajes</h1>
              <div className="flex items-center gap-2 rounded-full bg-[var(--surface2)] px-3.5 py-2">
                <Search className="h-4 w-4 shrink-0 text-[var(--secondary)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar"
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              {convLoading && !convData ? (
                <SpinnerBlock label="Cargando chats…" />
              ) : convError ? (
                <p className="px-4 py-10 text-center text-[14px] text-[#ff3b30]">No se pudieron cargar los chats.</p>
              ) : filtered.length === 0 ? (
                <p className="px-4 py-10 text-center text-[14px] text-[var(--secondary)]">
                  {search ? "Sin resultados." : "No tenés mensajes todavía."}
                </p>
              ) : (
                filtered.map((c) => (
                  <ConversationRow
                    key={c.id}
                    conv={c}
                    active={c.id === selectedId}
                    onClick={() => setSelectedId(c.id)}
                  />
                ))
              )}
            </div>
          </aside>

          {/* ── Panel derecho: chat activo ── */}
          <section className={`${selectedId != null ? "flex" : "hidden lg:flex"} min-w-0 flex-1 flex-col bg-[var(--bg)]`}>
            {selected ? (
              <>
                {/* Cabecera glass fija */}
                <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--separator)] bg-[var(--bg)]/80 px-3 py-2.5 backdrop-blur-md">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-[var(--accent)] active:bg-[var(--surface2)] lg:hidden"
                    aria-label="Volver"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <Avatar name={selected.contact.name} url={selected.contact.avatarUrl} size={40} online={selected.contact.online} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-[var(--fg)]">{selected.contact.name}</p>
                    <p className="truncate text-[12px] text-[var(--secondary)]">
                      {selected.contact.online ? "Conectado" : selected.contact.role ?? "Desconectado"}
                    </p>
                  </div>
                </header>

                {/* Mensajes */}
                <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
                  {msgLoading && messages.length === 0 ? (
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
                  Elegí una conversación para empezar a chatear.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
