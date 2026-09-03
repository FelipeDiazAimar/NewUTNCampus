# ---------------------------------------------------------------------------
# Worker del captcha remoto (via supervisor).
#
# Corre el Chromium ACA (IP residencial, sin proxy) y expone el WebSocket por
# un Cloudflare quick tunnel. El SUPERVISOR (supervisor.mts) mantiene vivos
# tunel + worker (los reinicia si se caen) y atiende comandos desde
# /admin/dashboard (reiniciar / frenar / arrancar) sin SSH.
#
# Params:
#   -Headful              Chrome con ventana visible (mejor reputacion)
#   -Origin URL           allowlist: solo acepta conexiones de ese origin
#   -MaxSesiones N        captcha en paralelo (default 2; 16GB -> ~14)
#   -MaxCola N            gente que puede quedar ESPERANDO (default 40)
#   -Pool N               contextos pre-cargados (arranque ~0s; default 0)
#   -Name TXT             nombre del worker en el monitor (default: hostname)
#   -AppUrl URL           base de la app (heartbeat + comandos). Se guarda en
#                         app-url.txt y se reusa.
#
# Setup (una vez):
#   1) Supabase: correr scripts/captcha-workers.sql y captcha-workers-comando.sql
#   2) Vercel -> Environment Variables:
#        NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN = (lo imprime este script)
#        CAPTCHA_HEARTBEAT_SECRET         = (lo imprime este script)
#      Borrar CAPTCHA_PROXIES. Redeploy.
#
# Con el heartbeat andando NO hace falta tocar NEXT_PUBLIC_CAPTCHA_WS_URL en
# cada reinicio: el cliente toma la URL de /api/captcha/endpoint.
#
# Auto-arranque al bootear:  .\install-tarea.ps1   (Task Scheduler)
# ---------------------------------------------------------------------------
param(
  [switch]$Headful,
  [string]$Origin = "",
  [int]$MaxSesiones = 0,
  [int]$MaxCola = 0,
  [int]$Pool = 0,
  [string]$Name = "",
  [string]$AppUrl = ""
)
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$root = (Resolve-Path (Join-Path $dir "..\..")).Path
$bin = Join-Path $dir "bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null

function New-Secret {
  $chars = (48..57) + (65..90) + (97..122)
  -join (1..32 | ForEach-Object { [char]($chars | Get-Random) })
}
function Get-OrCreate([string]$file, [string]$etiqueta) {
  if (Test-Path $file) { return (Get-Content $file -Raw).Trim() }
  $v = New-Secret
  $v | Set-Content $file -Encoding ascii -NoNewline
  Write-Host "$etiqueta nuevo -> $(Split-Path $file -Leaf)"
  return $v
}

# 1) Secretos
$TOKEN = Get-OrCreate (Join-Path $dir "worker-token.txt") "Token del worker"
$HBSECRET = Get-OrCreate (Join-Path $dir "heartbeat-secret.txt") "Secreto de heartbeat"

# 2) App URL
$appUrlFile = Join-Path $dir "app-url.txt"
if ($AppUrl) { $AppUrl.TrimEnd("/") | Set-Content $appUrlFile -Encoding ascii -NoNewline }
elseif (Test-Path $appUrlFile) { $AppUrl = (Get-Content $appUrlFile -Raw).Trim() }
if (-not $AppUrl) { Write-Host "AVISO: sin -AppUrl, no hay monitor ni comandos remotos." }

# 3) Nombre + version
if (-not $Name) { $Name = $env:COMPUTERNAME }
$VER = ""
try { Push-Location $root; $VER = (& git rev-parse --short HEAD 2>$null); Pop-Location } catch {}

# 4) Chromium de Playwright
Write-Host "Verificando Chromium de Playwright..."
Push-Location $root
try { & npx --yes playwright install chromium 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "  $_" } }
finally { Pop-Location }

# 5) cloudflared
$cf = Join-Path $bin "cloudflared.exe"
if (-not (Test-Path $cf)) {
  Write-Host "Descargando cloudflared..."
  Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf
}

# 6) Node 22.6+
$nodeMajor = [int](& node -e "console.log(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 22) { throw "Node ${nodeMajor}: se necesita Node 22.6+ (idealmente 24)." }

# 7) Env para el supervisor (pasa todo al worker)
$env:CAPTCHA_WORKER_PORT = "8788"
$env:CAPTCHA_WORKER_TOKEN = $TOKEN
$env:CAPTCHA_WORKER_NAME = $Name
$env:CAPTCHA_WORKER_VERSION = "$VER"
$env:CAPTCHA_APP_URL = $AppUrl
$env:CAPTCHA_HEARTBEAT_SECRET = $HBSECRET
$env:CLOUDFLARED_PATH = $cf
if ($Origin) { $env:CAPTCHA_ALLOWED_ORIGINS = $Origin }
if ($Headful) { $env:CAPTCHA_HEADFUL = "1" }
if ($MaxSesiones -gt 0) { $env:CAPTCHA_MAX_SESIONES = "$MaxSesiones" }
if ($MaxCola -gt 0) { $env:CAPTCHA_MAX_COLA = "$MaxCola" }
if ($Pool -gt 0) { $env:CAPTCHA_POOL = "$Pool" }

Write-Host ""
Write-Host "===================================================================="
Write-Host " Worker '$Name'  ver=$VER"
Write-Host "   MaxSesiones=$(if($MaxSesiones){$MaxSesiones}else{'2'})  MaxCola=$(if($MaxCola){$MaxCola}else{'40'})  Pool=$(if($Pool){$Pool}else{'0'})  Headful=$($Headful.IsPresent)"
Write-Host "   Monitor/comandos: $(if($AppUrl){$AppUrl}else{'OFF (pasa -AppUrl)'})"
Write-Host ""
Write-Host " EN VERCEL (una vez):"
Write-Host "   NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN = $TOKEN"
Write-Host "   CAPTCHA_HEARTBEAT_SECRET         = $HBSECRET"
Write-Host "   (borra CAPTCHA_PROXIES) -> Redeploy"
Write-Host ""
Write-Host " El supervisor mantiene vivo todo y atiende /admin/dashboard."
Write-Host " Ctrl+C para frenar."
Write-Host "===================================================================="
Write-Host ""

& node (Join-Path $dir "supervisor.mts")
