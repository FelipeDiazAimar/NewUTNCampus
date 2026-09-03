# ---------------------------------------------------------------------------
# Worker del captcha remoto + tunel + heartbeat.
#
# Corre el Chromium ACA (IP residencial de esta PC, sin proxy) y expone el
# WebSocket con un Cloudflare quick tunnel (TLS -> wss://). Por el tunel viaja
# SOLO el WebSocket de la app, no el trafico de Google.
#
# Params:
#   -Headful              Chrome con ventana visible (mejor reputacion)
#   -Origin URL           allowlist: solo acepta conexiones de ese origin
#   -MaxSesiones N        captcha en paralelo (default 2; 16GB -> ~14)
#   -MaxCola N            gente que puede quedar ESPERANDO (default 40)
#   -Pool N               contextos pre-cargados (arranque ~0s; default 0)
#   -Name TXT             nombre del worker en el monitor (default: hostname)
#   -AppUrl URL           base de la app (para el heartbeat al monitor). Se
#                         guarda en app-url.txt y se reusa si no lo pasas.
#
# Setup (una vez):
#   1) En Vercel -> Environment Variables:
#        NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN = (lo imprime este script)
#        CAPTCHA_HEARTBEAT_SECRET         = (lo imprime este script)
#      Borrar CAPTCHA_PROXIES. Redeploy.
#   2) Correr la migracion scripts/captcha-workers.sql en Supabase.
# Con el heartbeat andando NO hace falta tocar NEXT_PUBLIC_CAPTCHA_WS_URL en
# cada reinicio: el cliente toma la URL del worker de /api/captcha/endpoint.
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
$PORT = 8788
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

# 1) Secretos (se generan una vez)
$TOKEN = Get-OrCreate (Join-Path $dir "worker-token.txt") "Token del worker"
$HBSECRET = Get-OrCreate (Join-Path $dir "heartbeat-secret.txt") "Secreto de heartbeat"

# 2) App URL (para el heartbeat). Param > app-url.txt.
$appUrlFile = Join-Path $dir "app-url.txt"
if ($AppUrl) { $AppUrl.TrimEnd("/") | Set-Content $appUrlFile -Encoding ascii -NoNewline }
elseif (Test-Path $appUrlFile) { $AppUrl = (Get-Content $appUrlFile -Raw).Trim() }
if (-not $AppUrl) { Write-Host "AVISO: sin -AppUrl, el monitor no va a recibir heartbeat." }

# 3) Nombre del worker
if (-not $Name) { $Name = $env:COMPUTERNAME }

# 4) Version (git sha corto, best-effort)
$VER = ""
try { Push-Location $root; $VER = (& git rev-parse --short HEAD 2>$null); Pop-Location } catch {}

# 5) Chromium de Playwright (una vez)
Write-Host "Verificando Chromium de Playwright..."
Push-Location $root
try { & npx --yes playwright install chromium 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "  $_" } }
finally { Pop-Location }

# 6) cloudflared
$cf = Join-Path $bin "cloudflared.exe"
if (-not (Test-Path $cf)) {
  Write-Host "Descargando cloudflared..."
  Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf
}

# 7) Node 22.6+
$nodeMajor = [int](& node -e "console.log(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 22) { throw "Node ${nodeMajor}: se necesita Node 22.6+ (idealmente 24) para correr .mts nativo." }

# 8) Tunel PRIMERO (para conocer la wss_url antes de arrancar el worker)
Write-Host "Abriendo Cloudflare quick tunnel..."
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $cf
$psi.Arguments = "tunnel --url http://localhost:$PORT --no-autoupdate"
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$cfp = [System.Diagnostics.Process]::Start($psi)

$wssHost = $null
$rx = 'https://([a-z0-9-]+\.trycloudflare\.com)'
for ($i = 0; $i -lt 150 -and -not $cfp.HasExited; $i++) {
  $line = $cfp.StandardError.ReadLine()
  if ($null -eq $line) { Start-Sleep -Milliseconds 200; continue }
  $m = [regex]::Match($line, $rx)
  if ($m.Success) { $wssHost = $m.Groups[1].Value; break }
}
if (-not $wssHost) { throw "No pude leer la URL de cloudflared." }
# Drena el stderr de cloudflared en segundo plano (si no, el buffer del pipe
# se llena y cloudflared se cuelga tras un rato).
$null = $cfp.StandardError.ReadToEndAsync()
$WSS = "wss://$wssHost"

# 9) Arrancar el worker (TS nativo de Node)
$env:CAPTCHA_WORKER_PORT = "$PORT"
$env:CAPTCHA_WORKER_TOKEN = $TOKEN
$env:CAPTCHA_WORKER_NAME = $Name
$env:CAPTCHA_WORKER_WSS_URL = $WSS
$env:CAPTCHA_WORKER_VERSION = "$VER"
$env:CAPTCHA_APP_URL = $AppUrl
$env:CAPTCHA_HEARTBEAT_SECRET = $HBSECRET
if ($Origin) { $env:CAPTCHA_ALLOWED_ORIGINS = $Origin }
if ($Headful) { $env:CAPTCHA_HEADFUL = "1" }
if ($MaxSesiones -gt 0) { $env:CAPTCHA_MAX_SESIONES = "$MaxSesiones" }
if ($MaxCola -gt 0) { $env:CAPTCHA_MAX_COLA = "$MaxCola" }
if ($Pool -gt 0) { $env:CAPTCHA_POOL = "$Pool" }

$worker = Start-Process node -ArgumentList "`"$(Join-Path $dir 'server.mts')`"" -PassThru -NoNewWindow
Start-Sleep -Seconds 2
if ($worker.HasExited) {
  Stop-Process -Id $cfp.Id -ErrorAction SilentlyContinue
  throw "El worker no arranco (revisa la consola)."
}

Write-Host ""
Write-Host "===================================================================="
Write-Host " Worker '$Name'  ver=$VER   WSS: $WSS"
Write-Host "   MaxSesiones=$(if($MaxSesiones){$MaxSesiones}else{'2'})  MaxCola=$(if($MaxCola){$MaxCola}else{'40'})  Pool=$(if($Pool){$Pool}else{'0'})  Headful=$($Headful.IsPresent)"
Write-Host "   Heartbeat: $(if($AppUrl){$AppUrl + ' (monitor ON)'}else{'OFF (pasa -AppUrl)'})"
Write-Host ""
Write-Host " EN VERCEL (una vez, si no lo hiciste):"
Write-Host "   NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN = $TOKEN"
Write-Host "   CAPTCHA_HEARTBEAT_SECRET        = $HBSECRET"
Write-Host "   (borra CAPTCHA_PROXIES) -> Redeploy"
Write-Host ""
Write-Host " Fallback manual (opcional): NEXT_PUBLIC_CAPTCHA_WS_URL = $WSS"
Write-Host ""
Write-Host " DEJA ESTA VENTANA ABIERTA. Ctrl+C para frenar todo."
Write-Host "===================================================================="

try { $cfp.WaitForExit() }
finally {
  Stop-Process -Id $worker.Id -ErrorAction SilentlyContinue
  if (-not $cfp.HasExited) { Stop-Process -Id $cfp.Id -ErrorAction SilentlyContinue }
  Write-Host "Worker y tunel detenidos."
}
