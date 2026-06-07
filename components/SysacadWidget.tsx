"use client";

import { useState } from "react";
import Spinner from "@/components/Spinner";

/** Regional fija: San Francisco (code 12). El widget solo se usa para FRSF. */
const FACULTAD_SAN_FRANCISCO = 12;

const OFICINA_ALUMNOS = "oficinaestudiantes@fr.sanfrancisco.utn.edu.ar";

export interface SysacadCredentials {
  facultad: number;
  legajo: string;
  password: string;
  remember: boolean;
}

interface SysacadWidgetProps {
  /** Recibe las credenciales validadas al enviar el formulario. */
  onSubmit?: (credentials: SysacadCredentials) => void | Promise<void>;
  /** Muestra el spinner y bloquea los campos mientras se procesa el ingreso. */
  loading?: boolean;
  /** Mensaje de error a mostrar debajo de los campos. */
  error?: string;
}

export default function SysacadWidget({
  onSubmit,
  loading = false,
  error,
}: SysacadWidgetProps) {
  const [legajo, setLegajo] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    await onSubmit?.({ facultad: FACULTAD_SAN_FRANCISCO, legajo, password, remember });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-[340px] flex flex-col gap-0"
    >
      <div className="text-center mb-6">
        <p className="text-xs font-semibold tracking-widest text-[var(--accent)] uppercase mb-1">
          UTN · Sysacad
        </p>
        <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">
          Ingresar a Sysacad
        </h2>
        <p className="text-sm text-[var(--secondary)] mt-0.5">
          Autogestión de Estudiantes
        </p>
      </div>

      {/* Tarjeta agrupada estilo iOS: filas separadas por hairlines */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--separator)] overflow-hidden mb-4 shadow-sm">
        {/* Legajo */}
        <div className="flex items-center px-4 py-0 border-b border-[var(--separator)]">
          <label
            htmlFor="sysacad-legajo"
            className="text-sm font-medium text-[var(--fg)] w-24 shrink-0 py-3.5"
          >
            Legajo
          </label>
          <input
            id="sysacad-legajo"
            type="text"
            name="legajo"
            inputMode="numeric"
            value={legajo}
            onChange={(e) =>
              setLegajo(e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            placeholder="4141"
            maxLength={10}
            pattern="[0-9]{1,10}"
            title="Solo se admiten números"
            required
            disabled={loading}
            autoComplete="username"
            className="login-input flex-1 py-3.5 text-sm text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none bg-transparent disabled:opacity-50"
          />
        </div>

        {/* Contraseña */}
        <div className="flex items-center px-4 py-0">
          <label
            htmlFor="sysacad-password"
            className="text-sm font-medium text-[var(--fg)] w-24 shrink-0 py-3.5"
          >
            Contraseña
          </label>
          <input
            id="sysacad-password"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            maxLength={11}
            required
            disabled={loading}
            autoComplete="current-password"
            title="Si es la primera vez que usás el sistema ingresá tu Nº de documento (sin puntos) como contraseña"
            className="login-input flex-1 py-3.5 text-sm text-[var(--fg)] placeholder:text-[var(--secondary)] outline-none bg-transparent disabled:opacity-50"
          />
        </div>
      </div>

      <label className="flex items-center gap-2.5 mb-4 px-1 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          disabled={loading}
          className="w-[18px] h-[18px] accent-[#007aff] rounded disabled:opacity-50"
        />
        <span className="text-[13px] text-[var(--fg)]">
          Mantener sesión iniciada en este dispositivo
        </span>
      </label>

      {error && (
        <p className="text-[13px] text-[#ff3b30] text-center mb-4 px-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 rounded-2xl bg-[#007aff] text-white font-semibold text-[15px] active:opacity-80 disabled:opacity-60 transition-opacity shadow-sm flex items-center justify-center gap-2.5"
      >
        {loading ? (
          <>
            <Spinner size={18} color="#ffffff" />
            <span>Verificando…</span>
          </>
        ) : (
          "Ingresar"
        )}
      </button>

      {/* Texto de ayuda */}
      <p className="text-[12px] text-[#aeaeb2] mt-8 text-center max-w-xs mx-auto leading-relaxed">
        Si te olvidaste la contraseña ponete en contacto con la oficina Alumnos:{" "}
        <a
          href={`mailto:${OFICINA_ALUMNOS}`}
          className="text-[var(--accent)] font-medium break-all hover:underline"
        >
          {OFICINA_ALUMNOS}
        </a>
      </p>
    </form>
  );
}
