import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminPanelClient from "../_components/AdminPanelClient";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/adminAuth";

export default async function AdminTestNotisPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!verifyAdminSession(token)) redirect("/admin/login?next=/admin/testnotis");

  return <AdminPanelClient />;
}
