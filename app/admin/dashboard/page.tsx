import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminDashboardClient from "./_components/AdminDashboardClient";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/adminAuth";

export default async function AdminDashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!verifyAdminSession(token)) redirect("/admin/login?next=/admin/dashboard");

  return <AdminDashboardClient />;
}
