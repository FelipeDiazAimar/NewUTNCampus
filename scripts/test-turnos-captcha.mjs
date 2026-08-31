// Test A: POST a envio_turno.php SIN g-recaptcha-response
// Test B: mismo POST con token basura (solo corre si A es rechazado)
//
// ATENCION: si el backend NO valida el captcha, esto crea un turno REAL.
// Usa datos de prueba o tus propios datos, y correlo una sola vez.
//
// Uso:  node scripts/test-turnos-captcha.mjs

const BASE = 'https://turnos.frsfco.utn.edu.ar:4443';

// --- EDITA ESTOS DATOS ---
const DATOS = {
  responsable: '23',
  tematica: '1059',
  obs: '',
  datepicker: '31/08/2026',
  horarios: '',
  turnos_lote: JSON.stringify([
    {
      fecha: '31/08/2026',
      idHorario: '33',
      horarioDesc: '16:00',
      idResponsable: '23',
      responsableDesc: 'BIBLIOTECA - Uso Salas',
      idTematica: '1059',
      tematicaDesc: 'Uso de Salas para Estudio',
    },
  ]),
  tipoasistencia: 'Presencial',
  tipo_contacto: 'Cursante',
  carrera: 'UTN-Ingenieria en Sistemas de Informacion',
  tipo_documento: 'DNI',
  nro_documento: '46366511',
  nombre: 'Ulises',
  apellido: 'Araya',
  uploadedFile: '',
  email: 'ulisesdavid.araya@gmail.com',
  telefono: '03406519029',
  localidad: 'SAN FRANCISCO (DTO. SAN JUSTO)',
  provincia: 'Córdoba',
  enviar: 'Solicitar Turno',
};
// -------------------------

function visible(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getSesion() {
  const res = await fetch(BASE + '/', { redirect: 'manual' });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookies = setCookie
    .map((c) => c.split(';')[0])
    .filter((c) => /^(PHPSESSID|__utma|__utmb|__utmc|__utmz)/.test(c));
  console.log('Sesion:', cookies.join('; ') || '(ninguna)');
  return cookies.join('; ');
}

async function enviar(label, token) {
  const form = new FormData();
  for (const [k, v] of Object.entries(DATOS)) form.append(k, v);
  if (token !== undefined) form.append('g-recaptcha-response', token);

  const res = await fetch(BASE + '/envio/envio_turno.php', {
    method: 'POST',
    headers: {
      Cookie: globalThis.__COOKIE__,
      Origin: BASE,
      Referer: BASE + '/',
    },
    body: form,
  });
  const html = await res.text();
  const texto = visible(html);
  console.log(`\n=== ${label} -> HTTP ${res.status} ===`);
  console.log(texto.slice(0, 500));
  return texto;
}

const esExito = (t) => /ya se encuentra ingresado|Muchas gracias/i.test(t);
const esRechazoCaptcha = (t) =>
  /captcha|recaptcha|robot|verificaci/i.test(t) && !esExito(t);

const cookie = await getSesion();
globalThis.__COOKIE__ = cookie;

console.log('\n########## TEST A: sin g-recaptcha-response ##########');
const respA = await enviar('TEST A (sin token)', undefined);

if (esExito(respA)) {
  console.log(
    '\n>>> RESULTADO: el backend NO valida el captcha. Tu página puede postear directo sin captcha.'
  );
} else if (esRechazoCaptcha(respA)) {
  console.log(
    '\n>>> El backend rechazó por captcha faltante. Corriendo TEST B (token basura)...'
  );
  const respB = await enviar('TEST B (token basura)', 'AAAAbasura_inventada_123');
  if (esExito(respB)) {
    console.log(
      '\n>>> RESULTADO: solo valida EXISTENCIA del campo, no el token contra Google. Un token cualquiera sirve.'
    );
  } else {
    console.log(
      '\n>>> RESULTADO: valida el token contra Google (siteverify). Camino posible: solver (2Captcha) o headless browser.'
    );
  }
} else {
  console.log('\n>>> Rechazo por otro motivo (revisá el mensaje arriba).');
}
