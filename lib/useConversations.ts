"use client";

import { useCallback, useEffect, useState } from "react";
import type { Conversation } from "@/lib/chat";

export type ConvState = { conversations: Conversation[]; meId: number };

// Caché a nivel módulo: al volver a /chat se muestra al instante lo ya cargado
// y se revalida en segundo plano (sin spinner ni re-streaming visible).
let cache: ConvState | null = null;

/** Carga batch de una sola tanda — para refresco / revalidación. */
async function fetchOnce(): Promise<ConvState> {
  const r = await fetch("/api/chat/conversations", { cache: "no-store" });
  if (r.status === 401) throw Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "No se pudieron cargar los chats.");
  return { conversations: j.conversations ?? [], meId: j.meId ?? 0 };
}

type StreamHandlers = {
  onConv: (c: Conversation) => void;
  onDone: (meId: number) => void;
  onError: (msg: string, status?: number) => void;
};

/** Consume el SSE de /stream, despachando cada conversación apenas llega. */
async function streamConversations(handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
  const res = await fetch("/api/chat/conversations/stream", { cache: "no-store", signal });
  if (res.status === 401) { handlers.onError("UNAUTHORIZED", 401); return; }
  if (!res.body) { handlers.onError("Sin cuerpo de respuesta"); return; }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // Procesa todos los frames SSE completos (separados por línea en blanco).
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        const obj = JSON.parse(dataLine.slice(5).trim());
        if (obj.type === "conv") handlers.onConv(obj.conv as Conversation);
        else if (obj.type === "done") handlers.onDone(obj.meId as number);
        else if (obj.type === "error") handlers.onError(obj.message ?? "Error", obj.status);
      } catch { /* frame incompleto/no JSON — ignorar */ }
    }
  }
}

/**
 * Conversaciones del chat con carga progresiva (streaming) y caché entre vistas.
 *  · Sin caché: abre el stream y va agregando cada conversación apenas llega.
 *  · Con caché: muestra al instante y revalida en segundo plano (batch).
 *  · Refresco periódico cada 30 s.
 */
export function useConversations(authed: boolean) {
  const [conversations, setConversations] = useState<Conversation[]>(cache?.conversations ?? []);
  const [meId, setMeId] = useState<number>(cache?.meId ?? 0);
  const [loading, setLoading] = useState<boolean>(!cache); // (inicial; no se setea dentro del efecto)
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  // Carga inicial.
  useEffect(() => {
    if (!authed) return;
    const ctrl = new AbortController();
    let cancelled = false;

    if (cache) {
      // Ya hay datos en pantalla: solo revalidar en segundo plano.
      fetchOnce()
        .then((s) => { if (cancelled) return; cache = s; setConversations(s.conversations); setMeId(s.meId); })
        .catch((e) => { if (!cancelled && (e as { status?: number })?.status === 401) setUnauthorized(true); });
      return () => { cancelled = true; ctrl.abort(); };
    }

    // Sin caché: streaming progresivo (loading ya arranca en true).
    const acc: Conversation[] = [];
    streamConversations(
      {
        onConv: (c) => { if (cancelled) return; acc.push(c); setConversations([...acc]); setLoading(false); },
        onDone: (id) => { if (cancelled) return; setMeId(id); setLoading(false); cache = { conversations: acc.slice(), meId: id }; },
        onError: (msg, status) => {
          if (cancelled) return;
          setLoading(false);
          if (status === 401) setUnauthorized(true);
          else setError(msg);
        },
      },
      ctrl.signal
    ).catch(() => { /* abortos: ignorar */ });

    return () => { cancelled = true; ctrl.abort(); };
  }, [authed]);

  // Refresco periódico en segundo plano.
  useEffect(() => {
    if (!authed) return;
    const id = setInterval(() => {
      fetchOnce()
        .then((s) => { cache = s; setConversations(s.conversations); setMeId(s.meId); })
        .catch((e) => { if ((e as { status?: number })?.status === 401) setUnauthorized(true); });
    }, 30_000);
    return () => clearInterval(id);
  }, [authed]);

  /** Actualización optimista local (ej.: marcar como leído). */
  const patch = useCallback((fn: (prev: Conversation[]) => Conversation[]) => {
    setConversations((prev) => {
      const next = fn(prev);
      cache = { conversations: next, meId: cache?.meId ?? 0 };
      return next;
    });
  }, []);

  /** Refresco inmediato (batch) — devuelve la lista nueva (para hallar una conv recién creada). */
  const refresh = useCallback(async (): Promise<ConvState> => {
    const s = await fetchOnce();
    cache = s;
    setConversations(s.conversations);
    setMeId(s.meId);
    return s;
  }, []);

  return { conversations, meId, loading, error, unauthorized, patch, refresh };
}
