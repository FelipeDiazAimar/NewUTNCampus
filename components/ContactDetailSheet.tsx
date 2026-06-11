"use client";

import { useEffect } from "react";
import { Mail, X } from "lucide-react";
import { avatarColor, getInitials, type Contact, type UserProfile } from "@/lib/chat";

// ─── helpers duplicados del chat (evitan import circular) ─────────────────────

function isDefaultAvatar(url?: string | null): boolean {
  return !url || /\/theme\/image\.php\/[^?]*\/u\/f\d/.test(url);
}

function proxiedAvatar(url: string): string {
  return /frsfco\.cvg\.utn\.edu\.ar/.test(url)
    ? `/api/files?url=${encodeURIComponent(url)}&inline=1`
    : url;
}

/** En móvil usa mailto:, en PC abre Gmail web. */
function emailHref(email: string): string {
  if (typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return `mailto:${email}`;
  }
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  contact: Contact;
  profile: UserProfile | null;
  loading: boolean;
  isOpen: boolean;
  onClose: () => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ContactDetailSheet({ contact, profile, loading, isOpen, onClose }: Props) {
  // Bloquea scroll del body mientras el sheet está abierto
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const name = profile?.name || contact.name;
  const showPhoto = !isDefaultAvatar(contact.avatarUrl);

  const details: { label: string; value: string }[] = [];
  if (profile?.email) details.push({ label: "Correo", value: profile.email });
  if (profile?.city) details.push({ label: "Ciudad", value: profile.city });
  if (profile?.country) details.push({ label: "País", value: profile.country });
  if (profile?.lastAccess) details.push({ label: "Último acceso", value: profile.lastAccess });

  return (
    <>
      {/* ── Backdrop — z-[60] cubre también el Navbar (z-50) ──────────────── */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden="true"
      />

      {/* ── Sheet ────────────────────────────────────────────────────────────── */}
      {/*
       * Mobile  → desliza desde abajo (translate-y-full → translate-y-0)
       * Desktop → desliza desde la derecha (translate-x-full → translate-x-0)
       *           se resetea translate-y a 0 para que no interfiera.
       */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Perfil de ${name}`}
        className={[
          "fixed z-[70] flex flex-col",
          "bg-[var(--surface)] border border-[var(--separator)] shadow-2xl",
          // Mobile: bottom sheet
          "bottom-0 left-0 right-0 max-h-[88vh] rounded-t-3xl",
          // sm+: right drawer
          "sm:bottom-auto sm:top-0 sm:right-0 sm:left-auto",
          "sm:h-full sm:w-[340px] sm:max-h-none",
          "sm:rounded-none sm:rounded-l-3xl sm:border-r-0",
          // transition
          "transition-transform duration-300 ease-in-out",
          // open / closed
          isOpen
            ? "translate-y-0 sm:translate-x-0 sm:translate-y-0"
            : "translate-y-full sm:translate-x-full sm:translate-y-0",
        ].join(" ")}
      >
        {/* Pull handle (solo mobile) */}
        <div className="flex shrink-0 justify-center pt-3 pb-1 sm:hidden" aria-hidden>
          <div className="h-1 w-10 rounded-full bg-[var(--separator)]" />
        </div>

        {/* Botón cerrar (solo desktop) */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar perfil"
          className="absolute right-4 top-4 hidden h-8 w-8 items-center justify-center rounded-full bg-[var(--surface2)] text-[var(--secondary)] transition-opacity hover:opacity-80 active:opacity-60 sm:flex"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Contenido scrolleable */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-10 pt-4 sm:pt-10">

          {/* ── Avatar grande ─────────────────────────────────────────────── */}
          <div className="mb-5 flex flex-col items-center gap-3">
            <div className="relative" style={{ width: 96, height: 96 }}>
              {showPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={proxiedAvatar(contact.avatarUrl!)}
                  alt={name}
                  className="h-full w-full rounded-full object-cover shadow-md ring-2 ring-[var(--separator)]"
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center rounded-full font-bold text-white shadow-md ring-2 ring-[var(--separator)]"
                  style={{ backgroundColor: avatarColor(name), fontSize: 36 }}
                >
                  {getInitials(name)}
                </div>
              )}
              {contact.online && (
                <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-[var(--surface)] bg-[#34c759]" />
              )}
            </div>

            <div className="text-center">
              <h2 className="text-2xl font-bold tracking-tight text-[var(--fg)]">{name}</h2>
              {contact.role && (
                <p className="mt-0.5 text-[14px] text-[var(--secondary)]">{contact.role}</p>
              )}
              <p className={`mt-0.5 text-[13px] font-medium ${contact.online ? "text-[#34c759]" : "text-[var(--secondary)]"}`}>
                {contact.online ? "Conectado ahora" : "Sin conexión"}
              </p>
            </div>
          </div>

          {/* ── Botones de acción (estilo iOS) ────────────────────────────── */}
          {profile?.email && (
            <div className="mb-6 flex justify-center gap-6">
              <div className="flex flex-col items-center gap-1.5">
                <a
                  href={emailHref(profile.email)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-[#007aff] text-white shadow-sm transition-opacity hover:opacity-90 active:opacity-70"
                  aria-label={`Enviar correo a ${name}`}
                >
                  <Mail className="h-6 w-6" />
                </a>
                <span className="text-[11px] font-medium text-[var(--secondary)]">Correo</span>
              </div>
            </div>
          )}

          {/* ── Spinner de carga ──────────────────────────────────────────── */}
          {loading && details.length === 0 && (
            <div className="flex justify-center py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--separator)] border-t-[#007aff]" />
            </div>
          )}

          {/* ── Lista de detalles estilo iOS grouped ──────────────────────── */}
          {details.length > 0 && (
            <div className="overflow-hidden rounded-2xl bg-[var(--surface2)]">
              {details.map((d, i) => (
                <div
                  key={d.label}
                  className={`flex items-start justify-between gap-3 px-4 py-3 ${
                    i < details.length - 1 ? "border-b border-[var(--separator)]" : ""
                  }`}
                >
                  <span className="shrink-0 text-[14px] text-[var(--secondary)]">{d.label}</span>
                  <span className="break-all text-right text-[14px] font-medium text-[var(--fg)]">
                    {d.label === "Correo" ? (
                      <a
                        href={emailHref(d.value)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#007aff]"
                      >
                        {d.value}
                      </a>
                    ) : (
                      d.value
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
