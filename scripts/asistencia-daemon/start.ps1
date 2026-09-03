# ---------------------------------------------------------------------------
# Daemon de asistencia (vía supervisor).
#
# Loguea al "Control de Asistencias" legacy con una cuenta-bot, pollea
# apply-leave.php y avisa a /api/webhooks/asistencia cuando se habilita la
# asistencia de una materia. El SUPERVISOR (supervisor.mts) lo mantiene vivo y
# atiende comandos desde /admin/dashboard (reiniciar / frenar / arrancar).
#
# Params:
#   -Name TXT     nombre del worker en el monitor (default: hostname)
#   -AppUrl URL   base de la app (heartbeat + comandos). Se guarda en app-url.txt.
#   -PollMs N     intervalo de poll en ms (default 120000)
#
# Setup (una vez):
#   1) Supabase: correr scripts/asistencia-workers.sql y
#      scripts/asistencia-avisos-log.sql
#   2) Pegar el MISMO NOTIFICATIONS_WEBHOOK_SECRET que esta en Vercel en
#      scripts/asistencia-daemon/secret.txt
#   3) Poner usuario y password de la cuenta-bot del legacy en credenciales.txt
#      (2 lineas: usuario / password)
#
# Auto-arranque al bootear:  .\install-tarea.ps1 -Args "-AppUrl https://... -Name esta-pc"
# ---------------------------------------------------------------------------
param(
  [string]$Name = "",
  [string]$AppUrl = "",
  [int]$PollMs = 0
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

# 2) Credenciales de la cuenta-bot del legacy (2 lineas: usuario / password)
$credFile = Join-Path $dir "credenciales.txt"
if (-not (Test-Path $credFile)) {
  Write-Host "FALTA scripts/asistencia-daemon/credenciales.txt - 2 lineas: usuario y password de la cuenta-bot."
  exit 1
}
$cred = Get-Content $credFile
$ASIS_USER = ($cred | Select-Object -First 1).Trim()
$ASIS_PASS = ($cred | Select-Object -Skip 1 -First 1).Trim()

# 3) App URL
$appUrlFile = Join-Path $dir "app-url.txt"
if ($AppUrl) { $AppUrl.TrimEnd("/") | Set-Content $appUrlFile -Encoding ascii -NoNewline }
elseif (Test-Path $appUrlFile) { $AppUrl = (Get-Content $appUrlFile -Raw).Trim() }
if (-not $AppUrl) { Write-Host "AVISO: sin -AppUrl no hay monitor ni comandos remotos." }

# 4) Nombre + version
if (-not $Name) { $Name = $env:COMPUTERNAME }
$VER = ""
try { Push-Location $root; $VER = (& git rev-parse --short HEAD 2>$null); Pop-Location } catch {}

# 5) Node 22.6+
$nodeMajor = [int](& node -e "console.log(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 22) { throw "Node ${nodeMajor}: se necesita Node 22.6+ (idealmente 24)." }

# 6) Env para el supervisor
$env:CAMPUS_APP_URL = $AppUrl
$env:NOTIFICATIONS_WEBHOOK_SECRET = $SECRET
$env:ASISTENCIA_WORKER_NAME = $Name
$env:ASISTENCIA_WORKER_VERSION = "$VER"
$env:ASISTENCIA_USER = $ASIS_USER
$env:ASISTENCIA_PASSWORD = $ASIS_PASS
if ($PollMs -gt 0) { $env:ASISTENCIA_POLL_MS = "$PollMs" }

Write-Host ""
Write-Host "===================================================================="
Write-Host " Daemon de asistencia '$Name'  ver=$VER"
Write-Host "   Monitor/comandos: $(if($AppUrl){$AppUrl}else{'OFF (pasa -AppUrl)'})"
Write-Host "   Poll: $(if($PollMs){$PollMs}else{'120000'}) ms"
Write-Host ""
Write-Host " El supervisor mantiene vivo el daemon y atiende /admin/dashboard."
Write-Host " Ctrl+C para frenar."
Write-Host "===================================================================="
Write-Host ""

& node (Join-Path $dir "supervisor.mts")
