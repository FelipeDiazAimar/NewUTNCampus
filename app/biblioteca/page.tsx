"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { BookMarked, Check, AlertCircle } from "lucide-react";
import Navbar from "@/components/Navbar";
import DropdownSelect, { type DropdownOption } from "@/components/DropdownSelect";
import CalendarPicker from "@/components/CalendarPicker";

type UserProfile = {
  nombre: string;
  apellido: string;
  dni: string;
  tipoDocumento: "DNI" | "Pasaporte" | "LC" | "LE" | "DU";
  email: string;
  telefono: string;
  localidad: string;
  provincia: string;
  carrera?: string;
};

type TurnoData = {
  area: string;
  tematica: string;
  fecha: string;
  horario: string;
};

type SubmitStatus = "idle" | "loading" | "success" | "error";

const AREAS_BIBLIOTECA = [
  { id: "32", label: "BIBLIOTECA - Uso Notebooks", responsable: "32/BIBLIOTECA - Uso Notebooks " },
  { id: "23", label: "BIBLIOTECA - Uso Salas", responsable: "23/BIBLIOTECA - Uso Salas " },
  { id: "31", label: "Espacio Progresar - Lun/Mié/Vie", responsable: "31/Espacio Progresar - Lunes-Miércoles-Viernes " },
  { id: "34", label: "Espacio Progresar - Mar/Jue", responsable: "34/Espacio Progresar - Martes-Jueves " },
];

const AREA_OPTIONS: DropdownOption[] = AREAS_BIBLIOTECA.map((a) => ({
  value: a.id,
  label: a.label,
}));

function getUserInfo() {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/moodle_user=([^;]+)/);
  if (!m) return null;
  try {
    const data = JSON.parse(decodeURIComponent(m[1]));
    return { fullname: data.fullname, userid: data.userid };
  } catch {
    return null;
  }
}

function getSysacadUser() {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/sysacadws_user=([^;]+)/);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
}

function getTodayDate(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function toApiDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function BibliotecaPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [userInfo, setUserInfo] = useState<{ fullname?: string; userid?: number } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const prefSaved = useRef(false);

  const [profile, setProfile] = useState<UserProfile>({
    nombre: "", apellido: "", dni: "", tipoDocumento: "DNI",
    email: "", telefono: "", localidad: "", provincia: "", carrera: "",
  });

  const [turno, setTurno] = useState<TurnoData>({
    area: AREAS_BIBLIOTECA[0].id,
    tematica: "",
    fecha: getTodayDate(),
    horario: "",
  });

  const [tematicaOpts, setTematicaOpts] = useState<DropdownOption[]>([]);
  const [tematicasLoading, setTematicasLoading] = useState(false);
  const [horarioOpts, setHorarioOpts] = useState<DropdownOption[]>([]);
  const [horariosLoading, setHorariosLoading] = useState(false);

  // ── Load tematicas ─────────────────────────────────────────────────────────
  const loadTematicas = useCallback(async (areaId: string, preferredTematica?: string) => {
    const area = AREAS_BIBLIOTECA.find((a) => a.id === areaId);
    if (!area) return;
    setTematicasLoading(true);
    setTematicaOpts([]);
    setHorarioOpts([]);
    try {
      const responsable = encodeURIComponent(area.responsable);
      const res = await fetch(`/api/biblioteca/tematicas?responsable=${responsable}`);
      const json = await res.json();
      const data: DropdownOption[] = Array.isArray(json) ? json : (json.options ?? []);
      setTematicaOpts(data);
      const pick = preferredTematica && data.find((d) => d.value === preferredTematica)
        ? preferredTematica
        : data[0]?.value ?? "";
      setTurno((prev) => ({ ...prev, tematica: pick, horario: "" }));
    } catch {
      // silence
    } finally {
      setTematicasLoading(false);
    }
  }, []);

  // ── Load horarios ──────────────────────────────────────────────────────────
  const loadHorarios = useCallback(async (area: string, tematica: string, fecha: string) => {
    if (!area || !tematica || !fecha) return;
    setHorariosLoading(true);
    setHorarioOpts([]);
    setTurno((prev) => ({ ...prev, horario: "" }));
    try {
      const res = await fetch("/api/biblioteca/horarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diapicker: toApiDate(fecha), area, tematica }),
      });
      const data: DropdownOption[] = await res.json();
      setHorarioOpts(data);
      if (data.length > 0) setTurno((prev) => ({ ...prev, horario: data[0].value }));
    } catch {
      // silence
    } finally {
      setHorariosLoading(false);
    }
  }, []);

  // ── Save to Supabase (fire-and-forget) ────────────────────────────────────
  const saveToSupabase = useCallback((fields: Record<string, unknown>) => {
    fetch("/api/biblioteca/preferencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }).catch(() => {});
  }, []);

  // ── Mount: load profile + prefs from Supabase ─────────────────────────────
  useEffect(() => {
    if (typeof document === "undefined") return;
    const moodleUser = getUserInfo();
    if (!moodleUser) { router.push("/"); return; }
    setMounted(true);
    setUserInfo(moodleUser);

    fetch("/api/biblioteca/preferencias")
      .then((r) => r.json())
      .then((data) => {
        if (!data) {
          // No Supabase record — try to seed from cookies / sysacad
          const sysUser = getSysacadUser();
          if (sysUser) {
            const [apellido, nombre] = (sysUser.nombre || "").split(",").map((s: string) => s.trim());
            setProfile((prev) => ({ ...prev, nombre: nombre || "", apellido: apellido || "" }));
          }
          if (moodleUser.fullname) {
            const parts = moodleUser.fullname.split(" ");
            setProfile((prev) => ({
              ...prev,
              nombre: prev.nombre || parts[0] || "",
              apellido: prev.apellido || parts.slice(1).join(" ") || "",
            }));
          }
          loadTematicas(AREAS_BIBLIOTECA[0].id);
          return;
        }

        // Hydrate profile from Supabase (only non-empty fields)
        setProfile((prev) => ({
          nombre: data.nombre || prev.nombre,
          apellido: data.apellido || prev.apellido,
          dni: data.dni || prev.dni,
          tipoDocumento: (data.tipo_documento as UserProfile["tipoDocumento"]) || prev.tipoDocumento,
          email: data.email || prev.email,
          telefono: data.telefono || prev.telefono,
          localidad: data.localidad || prev.localidad,
          provincia: data.provincia || prev.provincia,
          carrera: prev.carrera,
        }));

        // Hydrate turno preferences
        const areaId = data.area_id && AREAS_BIBLIOTECA.some((a) => a.id === data.area_id)
          ? data.area_id
          : AREAS_BIBLIOTECA[0].id;
        setTurno((prev) => ({ ...prev, area: areaId }));
        loadTematicas(areaId, data.tematica_id ?? undefined);
      })
      .catch(() => loadTematicas(AREAS_BIBLIOTECA[0].id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload horarios when tematica or fecha changes (after tematicas loaded)
  useEffect(() => {
    if (mounted && turno.tematica && turno.fecha) {
      loadHorarios(turno.area, turno.tematica, turno.fecha);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turno.tematica, turno.fecha, mounted]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleAreaChange = (areaId: string) => {
    setTurno((prev) => ({ ...prev, area: areaId, tematica: "", horario: "" }));
    setHorarioOpts([]);
    loadTematicas(areaId);
    prefSaved.current = false;
  };

  const handleTematicaChange = (tematicaId: string) => {
    setTurno((prev) => ({ ...prev, tematica: tematicaId, horario: "" }));
    setHorarioOpts([]);
    saveToSupabase({ area_id: turno.area, tematica_id: tematicaId });
    prefSaved.current = true;
  };

  const handleProfileChange = (field: keyof UserProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const saveProfile = () => {
    // Save to Supabase
    saveToSupabase({
      nombre: profile.nombre,
      apellido: profile.apellido,
      dni: profile.dni,
      tipo_documento: profile.tipoDocumento,
      email: profile.email,
      telefono: profile.telefono,
      localidad: profile.localidad,
      provincia: profile.provincia,
    });
    // Keep localStorage as offline cache
    localStorage.setItem("biblioteca_profile", JSON.stringify(profile));
    setProfileOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitStatus("loading");
    setErrorMsg("");
    try {
      if (!profile.nombre || !profile.apellido || !profile.dni || !profile.email) {
        setErrorMsg("Por favor completa tus datos personales primero.");
        setSubmitStatus("error");
        return;
      }
      if (!turno.area || !turno.tematica || !turno.fecha || !turno.horario) {
        setErrorMsg("Por favor completa todos los campos del turno.");
        setSubmitStatus("error");
        return;
      }

      const formData = new FormData();
      formData.append("nro_documento", profile.dni);
      formData.append("tipo_documento", profile.tipoDocumento);
      formData.append("nombre", profile.nombre);
      formData.append("apellido", profile.apellido);
      formData.append("email", profile.email);
      formData.append("telefono", profile.telefono);
      formData.append("localidad", profile.localidad);
      formData.append("provincia", profile.provincia);
      formData.append("responsable", turno.area);
      formData.append("tematica", turno.tematica);
      formData.append("datepicker", toApiDate(turno.fecha));
      formData.append("horarios", turno.horario);

      if (!prefSaved.current) saveToSupabase({ area_id: turno.area, tematica_id: turno.tematica });

      await new Promise((resolve) => setTimeout(resolve, 1500));
      setSubmitStatus("success");
      setTimeout(() => router.push("/dashboard"), 2000);
    } catch {
      setErrorMsg("Error al procesar el turno. Intenta de nuevo.");
      setSubmitStatus("error");
    }
  };

  if (!mounted || !userInfo) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <Navbar />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-pulse text-[var(--secondary)]">Cargando...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar fullname={userInfo.fullname} />

      <main className="pt-24 pb-10 px-4 md:px-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-[#34c759] to-[#30b0c0] shadow-sm">
            <BookMarked className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-[28px] font-bold text-[var(--fg)]">Biblioteca</h1>
            <p className="text-[14px] text-[var(--secondary)]">Reserva tu turno de acceso presencial</p>
          </div>
        </div>

        {/* Status banners */}
        {submitStatus === "success" && (
          <div className="mb-6 rounded-2xl border border-[#34c759]/30 bg-[#34c759]/10 p-4 flex gap-3">
            <Check className="w-5 h-5 text-[#34c759] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[14px] font-semibold text-[#34c759]">Turno reservado exitosamente</p>
              <p className="text-[13px] text-[var(--secondary)] mt-1">Te redireccionaremos en un momento...</p>
            </div>
          </div>
        )}
        {submitStatus === "error" && errorMsg && (
          <div className="mb-6 rounded-2xl border border-[#ff3b30]/30 bg-[#ff3b30]/10 p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-[#ff3b30] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[14px] font-semibold text-[#ff3b30]">Error</p>
              <p className="text-[13px] text-[var(--secondary)] mt-1">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Form card */}
        <form
          onSubmit={handleSubmit}
          className="mb-6 rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] backdrop-blur-xl shadow-sm overflow-visible"
        >
          <div className="p-6 space-y-5">

            {/* Área */}
            <div>
              <label className="block text-[13px] font-semibold text-[var(--fg)] uppercase tracking-wider mb-2">
                Área / Sala
              </label>
              <DropdownSelect
                value={turno.area}
                options={AREA_OPTIONS}
                onChange={handleAreaChange}
              />
            </div>

            {/* Temática */}
            <div>
              <label className="block text-[13px] font-semibold text-[var(--fg)] uppercase tracking-wider mb-2">
                Motivo / Temática
              </label>
              <DropdownSelect
                value={turno.tematica}
                options={tematicaOpts}
                onChange={handleTematicaChange}
                placeholder={tematicasLoading ? "Cargando temáticas..." : "Seleccionar temática"}
                loading={tematicasLoading}
                disabled={!tematicasLoading && tematicaOpts.length === 0}
              />
            </div>

            {/* Fecha */}
            <div>
              <label className="block text-[13px] font-semibold text-[var(--fg)] uppercase tracking-wider mb-2">
                Fecha
              </label>
              <CalendarPicker
                value={turno.fecha}
                onChange={(fecha) => setTurno((prev) => ({ ...prev, fecha, horario: "" }))}
                min={getTodayDate()}
              />
            </div>

            {/* Horario disponible */}
            <div>
              <label className="block text-[13px] font-semibold text-[var(--fg)] uppercase tracking-wider mb-2">
                Horario disponible
              </label>
              <DropdownSelect
                value={turno.horario}
                options={horarioOpts}
                onChange={(h) => setTurno((prev) => ({ ...prev, horario: h }))}
                placeholder={
                  horariosLoading
                    ? "Cargando horarios..."
                    : horarioOpts.length === 0 && turno.tematica
                    ? "Sin horarios disponibles para esta fecha"
                    : "Seleccionar horario"
                }
                loading={horariosLoading}
                disabled={!horariosLoading && horarioOpts.length === 0 && !!turno.tematica}
              />
              {!horariosLoading && horarioOpts.length === 0 && turno.tematica && (
                <p className="text-[12px] text-[#ff9500] mt-1.5">
                  No hay horarios disponibles para esta fecha. Probá con otro día.
                </p>
              )}
            </div>
          </div>

          {/* Submit */}
          <div className="px-6 py-4 border-t border-[var(--separator)] bg-[var(--surface2)] rounded-b-3xl">
            <button
              type="submit"
              disabled={submitStatus === "loading" || horariosLoading || !turno.horario}
              className="w-full rounded-2xl bg-gradient-to-r from-[#34c759] to-[#30b0c0] py-3.5 text-[16px] font-semibold text-white shadow-sm transition-all duration-200 active:scale-[0.98] disabled:opacity-60 hover:shadow-md"
            >
              {submitStatus === "loading" ? "Procesando..." : "Confirmar Turno"}
            </button>
          </div>
        </form>

        {/* Datos personales accordion */}
        <div className="rounded-3xl border border-[var(--navbar-border)] bg-[var(--surface)] overflow-hidden">
          <button
            type="button"
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-[var(--surface2)] transition-colors"
          >
            <h2 className="text-[16px] font-semibold text-[var(--fg)]">Mis Datos Personales</h2>
            <span
              className="text-[var(--secondary)] transition-transform duration-300 inline-block"
              style={{ transform: profileOpen ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              ▾
            </span>
          </button>

          {profileOpen && (
            <div className="border-t border-[var(--separator)] px-6 py-5 space-y-4 bg-[var(--surface2)]/40">
              <div>
                <label className="block text-[12px] font-semibold text-[var(--secondary)] uppercase tracking-wider mb-1.5">Tipo de Documento</label>
                <select
                  value={profile.tipoDocumento}
                  onChange={(e) => handleProfileChange("tipoDocumento", e.target.value as "DNI" | "Pasaporte" | "LC" | "LE" | "DU")}
                  className="w-full rounded-lg border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--fg)] outline-none focus:border-[#007aff]"
                >
                  {(["DNI", "Pasaporte", "LC", "LE", "DU"] as const).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {([ ["dni", "Nro. Documento", "12345678", "text"], ["nombre", "Nombre", "Juan", "text"] ] as const).map(([f, lbl, ph, tp]) => (
                  <div key={f}>
                    <label className="block text-[12px] font-semibold text-[var(--secondary)] uppercase tracking-wider mb-1.5">{lbl}</label>
                    <input type={tp} value={profile[f]} onChange={(e) => handleProfileChange(f, e.target.value)} placeholder={ph}
                      className="w-full rounded-lg border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--fg)] outline-none focus:border-[#007aff]" />
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[var(--secondary)] uppercase tracking-wider mb-1.5">Apellido</label>
                <input type="text" value={profile.apellido} onChange={(e) => handleProfileChange("apellido", e.target.value)} placeholder="Pérez"
                  className="w-full rounded-lg border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--fg)] outline-none focus:border-[#007aff]" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {([ ["email", "Email", "correo@utn.edu.ar", "email"], ["telefono", "Teléfono", "3564999999", "tel"] ] as const).map(([f, lbl, ph, tp]) => (
                  <div key={f}>
                    <label className="block text-[12px] font-semibold text-[var(--secondary)] uppercase tracking-wider mb-1.5">{lbl}</label>
                    <input type={tp} value={profile[f]} onChange={(e) => handleProfileChange(f, e.target.value)} placeholder={ph}
                      className="w-full rounded-lg border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--fg)] outline-none focus:border-[#007aff]" />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {([ ["localidad", "Localidad", "San Francisco"], ["provincia", "Provincia", "Córdoba"] ] as const).map(([f, lbl, ph]) => (
                  <div key={f}>
                    <label className="block text-[12px] font-semibold text-[var(--secondary)] uppercase tracking-wider mb-1.5">{lbl}</label>
                    <input type="text" value={profile[f]} onChange={(e) => handleProfileChange(f, e.target.value)} placeholder={ph}
                      className="w-full rounded-lg border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--fg)] outline-none focus:border-[#007aff]" />
                  </div>
                ))}
              </div>

              <button type="button" onClick={saveProfile}
                className="w-full rounded-lg bg-[#007aff] px-3.5 py-2.5 text-[14px] font-semibold text-white hover:bg-[#0071e3] transition-colors active:scale-95">
                Guardar Cambios
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-[12px] text-[var(--secondary)] mt-8">
          Tus datos personales se guardarán en este dispositivo para futuras reservas.
        </p>
      </main>
    </div>
  );
}
