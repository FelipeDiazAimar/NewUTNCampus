/**
 * Mensajería del Campus (Moodle core_message_*). Define:
 *  1. Las formas CRUDAS del web service (tal cual vienen en el HAR) → las usará
 *     el Route Handler para parsear sin tocar el DOM.
 *  2. Las formas LIMPIAS que consume el frontend (Contact / Message / Conversation).
 *  3. Mappers crudo → limpio y helpers de UI.
 *  4. Data MOCK temporal para diseñar la vista mientras armamos las API routes.
 *
 * Endpoints Moodle (vía POST /api/moodle → lib/ajax/service.php):
 *  - core_message_get_conversations         { userid, type, limitnum, limitfrom, favourites, mergeself }
 *  - core_message_get_conversation_messages { currentuserid, convid, newest, limitnum, limitfrom }
 *  - core_message_send_instant_messages     { messages: [{ touserid, text }] }
 */

// ─── Formas CRUDAS del web service ────────────────────────────────────────────

export interface MoodleMember {
  id: number;
  fullname: string;
  profileurl: string;
  profileimageurl: string;
  profileimageurlsmall: string;
  isonline: boolean;
  showonlinestatus: boolean;
  isblocked: boolean;
  iscontact: boolean;
  isdeleted: boolean;
  canmessage: boolean | null;
}

export interface MoodleMessage {
  id: number;
  useridfrom: number;
  text: string;        // HTML, p.ej. "<p>Hola…</p>"
  timecreated: number; // epoch en segundos
}

export interface MoodleConversation {
  id: number;
  name: string;        // "" en chats 1:1; el nombre real en grupos
  subname: string | null;
  imageurl: string | null;
  type: number;        // 1 = individual, 2 = grupo, 3 = self
  membercount: number;
  ismuted: boolean;
  isfavourite: boolean;
  isread: boolean;
  unreadcount: number | null;
  members: MoodleMember[];
  messages: MoodleMessage[]; // último mensaje (preview) en get_conversations
}

/** Respuesta de service.php: `[{ error, data }]`. */
export type MoodleWsEnvelope<T> = [{ error: boolean; data: T }];
export type GetConversationsData = { conversations: MoodleConversation[] };
export type GetMessagesData = { id: number; members: MoodleMember[]; messages: MoodleMessage[] };

// ─── Formas LIMPIAS para el frontend ──────────────────────────────────────────

export interface Contact {
  id: number;
  name: string;
  avatarUrl: string | null;
  online: boolean;
  /** Etiqueta opcional (Moodle no la trae; se infiere o se deja vacía). */
  role?: string;
}

export interface Message {
  id: number;
  fromId: number;
  text: string;      // texto plano (HTML saneado)
  timestamp: number; // epoch en MILISEGUNDOS
}

export interface Conversation {
  id: number;
  type: "individual" | "group" | "self";
  contact: Contact;    // el otro miembro (en 1:1) o el grupo
  lastMessage: string;
  lastTimestamp: number;
  unread: number;
  favourite: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Quita el HTML de un mensaje de Moodle → texto plano para burbujas y previews. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>\s*<p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const CONV_TYPE: Record<number, Conversation["type"]> = { 1: "individual", 2: "group", 3: "self" };

export function mapMessage(m: MoodleMessage): Message {
  return { id: m.id, fromId: m.useridfrom, text: stripHtml(m.text), timestamp: m.timecreated * 1000 };
}

/** Convierte una conversación cruda en la forma limpia (relativa al usuario actual). */
export function mapConversation(c: MoodleConversation, meId: number): Conversation {
  const other = c.members.find((m) => m.id !== meId) ?? c.members[0];
  const last = c.messages[0];
  return {
    id: c.id,
    type: CONV_TYPE[c.type] ?? "individual",
    contact: {
      id: other?.id ?? 0,
      name: c.name || other?.fullname || "Conversación",
      avatarUrl: c.imageurl || other?.profileimageurl || null,
      online: other?.isonline ?? false,
    },
    lastMessage: last ? stripHtml(last.text) : "",
    lastTimestamp: last ? last.timecreated * 1000 : 0,
    // Moodle a veces deja unreadcount en null aunque el chat esté sin leer:
    // usamos isread como respaldo para no perder el indicador.
    unread: c.unreadcount ?? (c.isread === false ? 1 : 0),
    favourite: c.isfavourite,
  };
}

// ─── Perfil extendido (scraped de /user/profile.php) ──────────────────────────

export interface UserProfile {
  id: number;
  name: string;
  email: string | null;
  city: string | null;
  country: string | null;
  lastAccess: string | null;
}

/** Iniciales (máx. 2) a partir del nombre. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = ["#007aff", "#34c759", "#ff9500", "#af52de", "#30b0c7", "#ff2d55", "#5856d6", "#ff3b30"];
export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const DAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** Hora estilo iOS: "14:32" hoy, "Ayer", día de semana, o DD/MM. */
export function formatChatTime(ts: number, now = Date.now()): string {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const diffDays = Math.floor((today.setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return DAY_SHORT[d.getDay()];
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
