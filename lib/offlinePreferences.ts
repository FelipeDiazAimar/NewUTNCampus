import { supabaseFetch } from "@/lib/supabase";

/**
 * Preferencias de almacenamiento offline (Supabase: `offline_preferences`),
 * una fila por usuario (username). Best-effort: si Supabase falla, degrada a
 * valores por defecto (todo desactivado) sin romper la UI.
 */

const TABLE = "offline_preferences";

export type OfflinePreferences = {
  filesEnabled: boolean;
  onboardingSeenAt: string | null;
};

const DEFAULTS: OfflinePreferences = { filesEnabled: false, onboardingSeenAt: null };

export async function getOfflinePreferences(username: string): Promise<OfflinePreferences> {
  try {
    const res = await supabaseFetch(
      `${TABLE}?username=eq.${encodeURIComponent(username)}&select=files_enabled,onboarding_seen_at`
    );
    if (!res.ok) return DEFAULTS;
    const rows = (await res.json()) as { files_enabled: boolean; onboarding_seen_at: string | null }[];
    if (!rows[0]) return DEFAULTS;
    return { filesEnabled: rows[0].files_enabled, onboardingSeenAt: rows[0].onboarding_seen_at };
  } catch {
    return DEFAULTS;
  }
}

export async function setOfflinePreferences(
  username: string,
  patch: { filesEnabled?: boolean; onboardingSeenAt?: string }
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { username, updated_at: new Date().toISOString() };
    if (patch.filesEnabled !== undefined) body.files_enabled = patch.filesEnabled;
    if (patch.onboardingSeenAt !== undefined) body.onboarding_seen_at = patch.onboardingSeenAt;

    const res = await supabaseFetch(`${TABLE}?on_conflict=username`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
