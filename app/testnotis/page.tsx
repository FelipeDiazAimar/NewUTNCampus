import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminPanelClient from "./_components/AdminPanelClient";

const SESSION_TOKEN = "campus-admin-2024-internal";

export default async function TestNotisPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_session_token")?.value;
  if (token !== SESSION_TOKEN) redirect("/admin/login?next=/testnotis");

  return <AdminPanelClient />;
}
