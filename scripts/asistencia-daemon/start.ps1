# ---------------------------------------------------------------------------
# Daemon de asistencia (vía supervisor).
#
# Vigila el "Control de Asistencias" legacy y avisa a /api/webhooks/asistencia
# cuando se habilita la asistencia de una materia. La cobertura sale de los
# usuarios que activan "Avisar asistencia disponible" en /notificaciones: la app
# guarda su credencial de Sysacad cifrada y el daemon la usa para ver sus
# comisiones. El SUPERVISOR (supervisor.mts) lo mantiene vivo y atiende comandos
# desde /admin/dashboard (reiniciar / frenar / arrancar).
#
# Params:
#   -Name TXT     nombre del worker en el monitor (default: hostname)
#   -AppUrl URL   base de la app (heartbeat + comandos). Se guarda en app-url.txt.
#
# Setup (una vez):
#   1) Supabase: correr scripts/asistencia-workers.sql,
#      scripts/asistencia-avisos-log.sql y scripts/asistencia-credenciales.sql
#   2) Pegar el MISMO NOTIFICATIONS_WEBHOOK_SECRET que esta en Vercel en
#      scripts/asistencia-daemon/secret.txt
#
# Auto-arranque al bootear:  .\install-tarea.ps1 -Args "-AppUrl https://... -Name esta-pc"
# ---------------------------------------------------------------------------
param(
  [string]$Name = "",
  [string]$AppUrl = ""
)
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$root = (Resolve-Path (Join-Path $dir "..\..")).Path

# 1) Secreto (mismo que Vercel) - NO se genera, lo pega el usuario.
$secretFile = Join-Path $dir "secret.txt"
if (-not (Test-Path $secretFile)) {
  Write-Host "FALTA scripts/asistencia-daemon/secret.txt - pega ahi el NOTIFICATIONS_WEBHOOK_SECRET de Vercel."
  exit 1
}
$SECRET = (Get-Content $secretFile -Raw).Trim()

# 2) App URL
$appUrlFile = Join-Path $dir "app-url.txt"
if ($AppUrl) { $AppUrl.TrimEnd("/") | Set-Content $appUrlFile -Encoding ascii -NoNewline }
elseif (Test-Path $appUrlFile) { $AppUrl = (Get-Content $appUrlFile -Raw).Trim() }
if (-not $AppUrl) { Write-Host "AVISO: sin -AppUrl no hay monitor ni comandos remotos." }

# 3) Nombre + version
if (-not $Name) { $Name = $env:COMPUTERNAME }
$VER = ""
try { Push-Location $root; $VER = (& git rev-parse --short HEAD 2>$null); Pop-Location } catch {}

# 4) Node 22.6+
$nodeMajor = [int](& node -e "console.log(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 22) { throw "Node ${nodeMajor}: se necesita Node 22.6+ (idealmente 24)." }

# 5) Env para el supervisor
$env:CAMPUS_APP_URL = $AppUrl
$env:NOTIFICATIONS_WEBHOOK_SECRET = $SECRET
$env:ASISTENCIA_WORKER_NAME = $Name
$env:ASISTENCIA_WORKER_VERSION = "$VER"

Write-Host ""
Write-Host "===================================================================="
Write-Host " Daemon de asistencia '$Name'  ver=$VER"
Write-Host "   Monitor/comandos: $(if($AppUrl){$AppUrl}else{'OFF (pasa -AppUrl)'})"
Write-Host ""
Write-Host " El supervisor mantiene vivo el daemon y atiende /admin/dashboard."
Write-Host " Ctrl+C para frenar."
Write-Host "===================================================================="
Write-Host ""

& node (Join-Path $dir "supervisor.mts")
