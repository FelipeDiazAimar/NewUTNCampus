import { timingSafeEqual } from "crypto";

/** Comparación de strings en tiempo constante (evita timing attacks sobre secretos). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * true si el request trae el NOTIFICATIONS_WEBHOOK_SECRET correcto en alguno de
 * los headers indicados. Fail-closed: si el env no está seteado, devuelve false.
 */
export function hasWorkerSecret(
  req: { headers: { get(name: string): string | null } },
  headerNames: string[] = ["x-worker-secret"],
): boolean {
  const secret = process.env.NOTIFICATIONS_WEBHOOK_SECRET;
  if (!secret) return false;
  return headerNames.some((h) => {
    const v = req.headers.get(h);
    return v != null && safeEqual(v, secret);
  });
}
