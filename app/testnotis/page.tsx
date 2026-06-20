import { redirect } from "next/navigation";

// El panel admin vive ahora en /admin/testnotis. Mantenemos esta ruta como
// redirección por compatibilidad con enlaces/marcadores antiguos.
export default function LegacyTestNotisPage() {
  redirect("/admin/testnotis");
}
