import { supabaseFetch } from "@/lib/supabase";

/**
 * Registro de sesiones de Campus por dispositivo (Supabase: `device_sessions`).
 *
 * Las sesiones de Moodle/Sysacad son cookies que viven en cada dispositivo y no
 * se pueden invalidar desde el servidor. Para poder "cerrar sesión en otros
 * dispositivos" llevamos un registro: cada dispositivo tiene un `device_id`
 * (cookie httpOnly) y una fila acá. Cuando una sesión se marca `revoked`, el
 * keep-alive de ese dispositivo (GET /api/auth) lo detecta y cierra la sesión.
 *
 * Todo es best-effort: si la tabla no existe o Supabase no responde, las
 * funciones degradan en silencio para no romper el login ni el keep-alive.
 */

export type DeviceSessionRow = {
  device_id: string;
  user_key: string;
  fullname: string | null;
  user_agent: string | null;
  revoked: boolean;
  created_at: string;
  last_seen_at: string;
};

const TABLE = "device_sessions";

/** Alta/actualización de la sesión del dispositivo al iniciar sesión. */
export async function upsertDeviceSession(params: {
  deviceId: string;
  userKey: string;
  fullname?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    const now = new Date().toISOString();
    await supabaseFetch(`${TABLE}?on_conflict=device_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        device_id: params.deviceId,
        user_key: params.userKey,
        fullname: params.fullname ?? null,
        user_agent: params.userAgent ?? null,
        revoked: false,
        last_seen_at: now,
      }),
    });
  } catch {
    /* best-effort */
  }
}

/** Marca actividad reciente. Sin error si la fila no existe. */
export async function touchDeviceSession(deviceId: string, userAgent?: string | null): Promise<void> {
  try {
    await supabaseFetch(`${TABLE}?device_id=eq.${encodeURIComponent(deviceId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_seen_at: new Date().toISOString(), ...(userAgent ? { user_agent: userAgent } : {}) }),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * ¿Esta sesión de dispositivo está revocada? Solo devuelve `true` cuando hay una
 * fila explícitamente marcada `revoked` — si la tabla no existe, la fila falta o
 * hay un error, devuelve `false` para no cerrar sesiones por equivocación.
 */
export async function isDeviceSessionRevoked(deviceId: string): Promise<boolean> {
  try {
    const res = await supabaseFetch(
      `${TABLE}?device_id=eq.${encodeURIComponent(deviceId)}&select=revoked`
    );
    if (!res.ok) return false;
    const rows = (await res.json()) as { revoked: boolean }[];
    return rows[0]?.revoked === true;
  } catch {
    return false;
  }
}

/** Sesiones activas (no revocadas) de un usuario, más recientes primero. */
export async function listDeviceSessions(userKey: string): Promise<DeviceSessionRow[]> {
  try {
    const res = await supabaseFetch(
      `${TABLE}?user_key=eq.${encodeURIComponent(userKey)}&revoked=eq.false&select=*&order=last_seen_at.desc`
    );
    if (!res.ok) return [];
    return (await res.json()) as DeviceSessionRow[];
  } catch {
    return [];
  }
}

/** Borra la fila del dispositivo (logout normal de ese mismo dispositivo). */
export async function deleteDeviceSession(deviceId: string): Promise<void> {
  try {
    await supabaseFetch(`${TABLE}?device_id=eq.${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Revoca sesiones de un usuario.
 * - `exceptDeviceId`: revoca todas menos esa (cerrar en *otros* dispositivos).
 * - `onlyDeviceId`: revoca solo esa.
 */
export async function revokeDeviceSessions(params: {
  userKey: string;
  exceptDeviceId?: string;
  onlyDeviceId?: string;
}): Promise<boolean> {
  try {
    let filter = `user_key=eq.${encodeURIComponent(params.userKey)}`;
    if (params.onlyDeviceId) {
      filter += `&device_id=eq.${encodeURIComponent(params.onlyDeviceId)}`;
    } else if (params.exceptDeviceId) {
      filter += `&device_id=neq.${encodeURIComponent(params.exceptDeviceId)}`;
    }
    const res = await supabaseFetch(`${TABLE}?${filter}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ revoked: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
