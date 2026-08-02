import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { MOODLE_BASE } from "@/lib/moodle";
import { REMEMBER_MAX_AGE } from "@/lib/cookies";

/**
 * Cifra URLs reales de Moodle en un token opaco (AES-256-GCM) para que el
 * cliente nunca vea el dominio/estructura del campus viejo — ni en las
 * respuestas JSON ni en query params visibles por F12. Mismo patrón que
 * lib/crypto.ts (SESSION_SECRET), pero con un salt propio para derivar una
 * clave distinta aunque el secreto de entorno sea el mismo.
 */
const SECRET = process.env.SESSION_SECRET || "campus-utn-dev-secret-change-me";
const KEY = scryptSync(SECRET, "campus-utn-urltoken-salt", 32);

interface UrlPayload {
  u: string;
  exp: number;
}

export function encodeUrlRef(url: string): string {
  const payload: UrlPayload = { u: url, exp: Date.now() + REMEMBER_MAX_AGE * 1000 };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decodeUrlRef(ref: string): string | null {
  try {
    const buf = Buffer.from(ref, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    const payload = JSON.parse(json) as UrlPayload;
    if (typeof payload.u !== "string" || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;
    if (!payload.u.startsWith(`${MOODLE_BASE}/`) && payload.u !== MOODLE_BASE) return null;
    return payload.u;
  } catch {
    return null;
  }
}
