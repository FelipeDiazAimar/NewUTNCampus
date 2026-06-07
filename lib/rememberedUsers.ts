/**
 * Cuentas (usuario/email) usadas con "Mantener sesión iniciada", guardadas SOLO
 * en este dispositivo (localStorage). Sirven para ofrecer un selector de cuentas
 * en el login del campus. No guarda contraseñas — solo el identificador.
 */
const KEY = "campus_remembered_users";
const MAX = 8;

export function getRememberedUsers(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function addRememberedUser(username: string): void {
  if (typeof window === "undefined") return;
  const u = username.trim();
  if (!u) return;
  const list = [u, ...getRememberedUsers().filter((x) => x.toLowerCase() !== u.toLowerCase())];
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export function removeRememberedUser(username: string): void {
  if (typeof window === "undefined") return;
  const list = getRememberedUsers().filter((x) => x.toLowerCase() !== username.toLowerCase());
  localStorage.setItem(KEY, JSON.stringify(list));
}
