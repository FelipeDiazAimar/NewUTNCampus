# Daemon de asistencia

Vigila el "Control de Asistencias" legacy de la facultad
(`asistencia.frsfco.utn.edu.ar:4443`) y, cuando se habilita la asistencia de una
materia, dispara una notificación push a la PWA de todos los usuarios que tengan
el aviso de asistencia activado. Al tocar la notificación se abre `/asistencia`.

## Por qué corre local (y no en un cron en la nube)

- Hay que chequear cada comisión cada ~10 min, con muchos logins al legacy.
  Vercel Cron (Hobby) corre 1 vez por día; GitHub Actions, cada 5 min y con
  retrasos → el aviso llegaría tarde y sin margen para el rate-limiting.
- El legacy chequea la red de la facultad. Desde una IP residencial / de la
  facultad es menos probable que bloquee que desde una IP de datacenter.

El daemon **no guarda estado local**: cada vuelta le pregunta al legacy y le
avisa al servidor; el servidor (`/api/webhooks/asistencia`) decide si ya se
avisó hoy de esa materia. Podés tener dos PCs corriéndolo: no se duplica el
aviso (y en el monitor se ven como dos workers).

## Requisitos

- Node 22.6+ en el PATH (idealmente 24). Windows con PowerShell.

## Setup (una vez)

1. En Supabase → SQL Editor, correr `scripts/asistencia-workers.sql`,
   `scripts/asistencia-avisos-log.sql` y `scripts/asistencia-credenciales.sql`.
2. Crear `scripts/asistencia-daemon/secret.txt` con el **mismo**
   `NOTIFICATIONS_WEBHOOK_SECRET` que está en Vercel.

No hay cuenta-bot. La cobertura sale sola de los usuarios que activan
"Avisar asistencia disponible" en `/notificaciones`: la app guarda su credencial
de Sysacad cifrada y el daemon la usa para ver sus comisiones.

Los `*.txt` (`secret.txt`, `app-url.txt`) están gitignoreados.

## Uso

```powershell
cd scripts/asistencia-daemon
.\start.ps1 -AppUrl https://campusutn.dpdns.org -Name esta-pc
```

Dejá la ventana abierta. `Ctrl+C` para frenar.

## Monitor y control remoto

En `/admin/dashboard`, sección "Daemon de asistencia — workers": ves si la PC
está conectada, hace cuánto, polls, tiempo de respuesta del legacy, errores,
materias detectadas hoy y pushes enviadas hoy. Los botones **Reiniciar /
Frenar / Arrancar** encolan un comando que el `supervisor.mts` ejecuta en ≤15s.

## Auto-arranque al bootear

```powershell
.\install-tarea.ps1 -Args "-AppUrl https://campusutn.dpdns.org -Name esta-pc"
```

Registra la tarea de Windows `CampusAsistenciaWorker` (arranca al iniciar
sesión, se reinicia sola si falla). En Linux: `asistencia-worker.service`.

## Mover a otra PC

Clonar el repo, copiar `secret.txt` y `app-url.txt`, tener Node 22.6+,
`.\start.ps1 -AppUrl <url> -Name <nombre>`.

## Usuarios nuevos

No hay nada que hacer. El aviso llega a toda suscripción push activa; cuando un
alumno instala la PWA y activa notificaciones, `/notificaciones` le crea el
perfil con la asistencia activada y el próximo aviso ya le llega. Si además
mantiene el toggle "Avisar asistencia disponible" activo, sus comisiones entran
automáticamente en la cobertura del daemon.
