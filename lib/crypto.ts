import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * Cifrado simétrico para guardar credenciales del "Mantener sesión iniciada".
 * AES-256-GCM con clave derivada de SESSION_SECRET (env). El blob va en una cookie
 * httpOnly, así nunca es legible por el cliente; solo el servidor puede descifrarlo.
 *
 * SESSION_SECRET es obligatorio en todos los entornos (sin fallback): con esta
 * clave se descifran credenciales de alumnos y se firman las sesiones de admin.
 * Definilo en .env.local (dev) y en Vercel → Environment Variables (prod).
 */
const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error("Falta SESSION_SECRET (env). Definilo en .env.local (dev) y en Vercel (prod).");
}
const KEY = scryptSync(SECRET, "campus-utn-cred-salt", 32);

export function encryptCred(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptCred(token: string): string | null {
  try {
    const buf = Buffer.from(token, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
