import { cookies } from "next/headers";
import ForoClient from "./_components/ForoClient";

const ADMIN_SESSION_TOKEN = "campus-admin-2024-internal";

export default async function ForoPage() {
  // El foro es público para usuarios autenticados; solo el admin obtiene la
  // bandeja de moderación. Leemos la cookie en el servidor (como en /admin).
  const cookieStore = await cookies();
  const isAdmin = cookieStore.get("admin_session_token")?.value === ADMIN_SESSION_TOKEN;

  return <ForoClient isAdmin={isAdmin} />;
}
