import { createHmac, scryptSync, timingSafeEqual } from "crypto";

/**
 * Sesión firmada del panel admin interno. Reusa SESSION_SECRET (mismo secreto
 * que lib/crypto.ts) pero con un salt propio, así una filtración de un tipo de
 * token no compromete al otro. HMAC alcanza acá — a diferencia de lib/urlToken,
 * no hay nada que ocultar dentro del token, solo que no se pueda falsificar.
 */
const SECRET = process.env.SESSION_SECRET || "campus-utn-dev-secret-change-me";
const KEY = scryptSync(SECRET, "campus-utn-admin-salt", 32);

export const ADMIN_SESSION_COOKIE = "admin_session_token";
/** Cookie no-secreta, legible por JS, que solo indica "hay sesión admin". */
export const ADMIN_UI_COOKIE = "admin_ui";

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24 horas, igual que antes

interface AdminPayload {
  iat: number;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", KEY).update(payload).digest("base64url");
}

export function createAdminSession(): string {
  const now = Date.now();
  const payload: AdminPayload = { iat: now, exp: now + SESSION_MAX_AGE_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyAdminSession(token: string | undefined | null): boolean {
  if (!token) return false;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return false;

  const expected = sign(encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AdminPayload;
    return typeof payload.exp === "number" && Date.now() < payload.exp;
  } catch {
    return false;
  }
}

export function isAdminRequest(req: { cookies: { get(name: string): { value: string } | undefined } }): boolean {
  return verifyAdminSession(req.cookies.get(ADMIN_SESSION_COOKIE)?.value);
}
