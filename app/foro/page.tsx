import { cookies } from "next/headers";
import ForoClient from "./_components/ForoClient";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/adminAuth";

export default async function ForoPage() {
  // El foro es público para usuarios autenticados; solo el admin obtiene la
  // bandeja de moderación. Leemos la cookie en el servidor (como en /admin).
  const cookieStore = await cookies();
  const isAdmin = verifyAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);

  return <ForoClient isAdmin={isAdmin} />;
}
