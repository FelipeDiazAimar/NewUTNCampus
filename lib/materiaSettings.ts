export interface MateriaSettings {
  color?: string;
  aula?: string;
}

const LS_KEY = "campus_materia_settings";

export function getAllMateriaSettings(): Record<string, MateriaSettings> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveMateriaSettings(name: string, s: Partial<MateriaSettings>): void {
  const all = getAllMateriaSettings();
  all[name] = { ...all[name], ...s };
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}

export function resetMateriaSettings(name: string): void {
  const all = getAllMateriaSettings();
  delete all[name];
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}
