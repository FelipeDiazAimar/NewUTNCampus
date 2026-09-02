// Cliente del sistema legacy de turnos (turnos.frsfco.utn.edu.ar:4443).
// Port del flujo probado en scripts/pedir-turno-biblioteca.mjs (HAR 30/08/2026).
//
// Requisitos descubiertos empíricamente:
//  - User-Agent de navegador OBLIGATORIO (otro UA => body vacío).
//  - Cookie PHPSESSID de un GET / previo + warm-up (búsqueda + disponibilidad).
//  - El token de captcha viaja en g-recaptcha-response (multipart) y NO está
//    atado a la sesión (validado: Test 3).

const BASE = "https://turnos.frsfco.utn.edu.ar:4443";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

export type DatosTurno = {
  responsable: string; // id de área, ej "23"
  areaDesc?: string;
  tematica: string; // id de temática, ej "1059"
  tematicaDesc?: string;
  fecha: string; // dd/MM/yyyy (formato del legacy)
  idHorario: string; // ej "33"
  horarioDesc: string; // ej "16:00"
  tipoDocumento: string;
  nroDocumento: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  localidad: string;
  provincia: string;
  carrera?: string;
  tipoAsistencia?: string;
  tipoContacto?: string;
};

export type ResultadoTurno = {
  ok: boolean;
  veredicto: string;
  fechaHora?: string;
  mensaje: string;
};

function clasificar(html: string): string {
  if (/ya se encuentra ingresado/i.test(html)) return "EXITO";
  if (/No se pudo probar que es un Humano/i.test(html)) return "RECHAZO_CAPTCHA";
  if (html.trim().length === 0) return "BODY_VACIO";
  if (/No existen Horarios/i.test(html)) return "SIN_DISPONIBILIDAD";
  if (/ya tiene|duplicad|ya se encuentra inscript/i.test(html)) return "DUPLICADO";
  return "OTRO";
}

async function iniciarSesion(): Promise<string> {
  const res = await fetch(`${BASE}/`, { redirect: "manual", headers: { "User-Agent": UA } });
  return (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .filter((c) => /^PHPSESSID/.test(c))
    .join("; ");
}

// Pasos previos al submit que hace el navegador en el flujo real. Sin ellos el
// servidor puede cortar en silencio; con ellos, reproduce el camino del HAR.
async function calentarSesion(cookie: string, d: DatosTurno): Promise<void> {
  const areaDesc = d.areaDesc || "Area";
  const temaDesc = d.tematicaDesc || "Tematica";
  const form = new URLSearchParams({
    resp: `${d.responsable}/${areaDesc} `,
    tema: `${d.tematica}/${temaDesc}`,
    bus_turnos: "",
  });
  await fetch(`${BASE}/`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE}/`,
      Origin: BASE,
    },
    body: form.toString(),
  }).then((r) => r.text());

  const qs = new URLSearchParams({
    diapicker: d.fecha,
    area: d.responsable,
    tematica: d.tematica,
  });
  await fetch(`${BASE}/funciones/disponibilidad_horarios.php?${qs.toString()}`, {
    method: "POST",
    headers: { Cookie: cookie, "User-Agent": UA, Referer: `${BASE}/` },
    body: qs.toString(),
  }).then((r) => r.text());
}

export async function pedirTurno(d: DatosTurno, captchaToken: string): Promise<ResultadoTurno> {
  if (!captchaToken || captchaToken.length < 50) {
    return { ok: false, veredicto: "TOKEN_INVALIDO", mensaje: "El token de captcha no es válido." };
  }

  const cookie = await iniciarSesion();
  if (!cookie) {
    return { ok: false, veredicto: "SIN_SESION", mensaje: "No se pudo iniciar sesión en el sistema de turnos." };
  }
  await calentarSesion(cookie, d);

  const body: Record<string, string> = {
    responsable: d.responsable,
    tematica: d.tematica,
    obs: "",
    datepicker: d.fecha,
    horarios: "",
    turnos_lote: JSON.stringify([
      {
        fecha: d.fecha,
        idHorario: d.idHorario,
        horarioDesc: d.horarioDesc,
        idResponsable: d.responsable,
        responsableDesc: d.areaDesc || "",
        idTematica: d.tematica,
        tematicaDesc: d.tematicaDesc || "",
      },
    ]),
    tipoasistencia: d.tipoAsistencia || "Presencial",
    tipo_contacto: d.tipoContacto || "Cursante",
    carrera: d.carrera || "UTN-Ingenieria en Sistemas de Informacion",
    tipo_documento: d.tipoDocumento,
    nro_documento: d.nroDocumento,
    nombre: d.nombre,
    apellido: d.apellido,
    uploadedFile: "",
    email: d.email,
    telefono: d.telefono,
    localidad: d.localidad,
    provincia: d.provincia,
    enviar: "Solicitar Turno",
  };

  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.append(k, v);
  form.append("g-recaptcha-response", captchaToken);

  const res = await fetch(`${BASE}/envio/envio_turno.php`, {
    method: "POST",
    headers: { Cookie: cookie, "User-Agent": UA, Origin: BASE, Referer: `${BASE}/` },
    body: form,
  });
  const html = await res.text();
  const veredicto = clasificar(html);
  const fechaHora = html.match(/(\d{2}\/\d{2}\/\d{4} - \d{2}:\d{2})/)?.[1];
  const alerta = html.match(/alert\("([^"]+)"/)?.[1];

  const mensajes: Record<string, string> = {
    EXITO: `Turno creado${fechaHora ? `: ${fechaHora}` : ""}. Vas a recibir un mail de confirmación.`,
    RECHAZO_CAPTCHA: "El sistema rechazó el captcha (posiblemente expiró). Resolvelo de nuevo.",
    SIN_DISPONIBILIDAD: "No hay horarios disponibles para esa fecha.",
    BODY_VACIO: "El sistema de turnos no respondió. Intentá de nuevo en unos minutos.",
    DUPLICADO: "Parece que ya tenés un turno registrado para esa fecha.",
  };

  return {
    ok: veredicto === "EXITO",
    veredicto,
    fechaHora,
    mensaje: mensajes[veredicto] || alerta || "El sistema devolvió una respuesta inesperada.",
  };
}
