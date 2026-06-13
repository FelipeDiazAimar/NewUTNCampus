"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserX, LogIn } from "lucide-react";
import { isGuestMode } from "@/lib/guest";

/**
 * Banda informativa visible debajo del Navbar cuando el usuario está en
 * modo invitado. Muestra el estado y un botón de "Iniciar sesión".
 * Se monta con cero efecto en producción cuando no hay cookie campus_guest.
 */
export default function GuestBanner() {
  const [show, setShow] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setShow(isGuestMode());
  }, []);

  if (!show) return null;

  return (
    <div className="max-w-[1600px] mx-auto px-4 -mt-4 mb-4">
      <div
        className="flex items-center gap-2.5 rounded-2xl px-4 py-2.5 shadow-sm border"
        style={{
          background: "rgba(52,199,89,0.08)",
          borderColor: "rgba(52,199,89,0.3)",
          color: "#34c759",
        }}
      >
        <UserX className="w-[18px] h-[18px] shrink-0" />
        <span className="flex-1 text-[13px] font-medium text-[var(--fg)]">
          Modo invitado —{" "}
          <span className="text-[var(--secondary)]">estás explorando con datos de ejemplo</span>
        </span>
        <button
          onClick={() => router.push("/")}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-[#007aff] text-white text-[12px] font-semibold px-3 py-1.5 active:opacity-80 transition-opacity"
        >
          <LogIn className="w-3 h-3" />
          Iniciar sesión
        </button>
      </div>
    </div>
  );
}
