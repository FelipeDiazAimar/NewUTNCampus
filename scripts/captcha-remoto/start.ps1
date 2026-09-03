# ---------------------------------------------------------------------------
# Worker del captcha remoto + tunel.
#
# Corre el Chromium ACA (IP residencial de esta PC, sin proxy) y expone el
# WebSocket con un Cloudflare quick tunnel (TLS incluido -> wss://). Por el
# tunel viaja SOLO el WebSocket de la app, no el trafico de Google.
#
# Uso:
#   .\start.ps1                 headless (default)
#   .\start.ps1 -Headful        Chrome con ventana visible (mejor reputacion)
#   .\start.ps1 -Origin https://tu-app.vercel.app   (allowlist de origin)
#
#   1) Ejecutar. Copiar las 2 env vars que imprime -> Vercel -> Settings ->
#      Environment Variables (Production + Preview).
#   2) BORRAR CAPTCHA_PROXIES en Vercel (o ponerla en off).
#   3) Redeploy. Dejar esta ventana abierta.
#
# El subdominio de trycloudflare.com cambia en cada arranque: al reiniciar,
# actualizar NEXT_PUBLIC_CAPTCHA_WS_URL en Vercel y redeploy.
# ---------------------------------------------------------------------------
#   .\start.ps1 -MaxSesiones 4   cuantos Chromium en simultaneo (default 2;
#                                ~300-500 MB de RAM cada uno)
param([switch]$Headful, [string]$Origin = "", [int]$MaxSesiones = 0)
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$root = (Resolve-Path (Join-Path $dir "..\..")).Path
$bin = Join-Path $dir "bin"
$tokFile = Join-Path $dir "worker-token.txt"
$PORT = 8788
New-Item -ItemType Directory -Force -Path $bin | Out-Null

# 1) Token (se genera una vez, queda en worker-token.txt)
if (Test-Path $tokFile) {
  $TOKEN = (Get-Content $tokFile -Raw).Trim()
} else {
  $chars = (48..57) + (65..90) + (97..122)
  $TOKEN = -join (1..32 | ForEach-Object { [char]($chars | Get-Random) })
  $TOKEN | Set-Content $tokFile -Encoding ascii -NoNewline
  Write-Host "Token nuevo guardado en worker-token.txt"
}

# 2) Browser de Playwright (una vez)
Write-Host "Verificando Chromium de Playwright..."
Push-Location $root
try { & npx --yes playwright install chromium 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "  $_" } }
finally { Pop-Location }

# 3) cloudflared
$cf = Join-Path $bin "cloudflared.exe"
if (-not (Test-Path $cf)) {
  Write-Host "Descargando cloudflared..."
  Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf
}

# 4) Arrancar el worker con el TS nativo de Node (24+): borra tipos sin
#    transformar, asi las funciones de page.evaluate() llegan intactas al
#    navegador (tsx/esbuild las rompia con "__name is not defined").
$env:CAPTCHA_WORKER_PORT = "$PORT"
$env:CAPTCHA_WORKER_TOKEN = $TOKEN
if ($Origin) { $env:CAPTCHA_ALLOWED_ORIGINS = $Origin }
if ($Headful) { $env:CAPTCHA_HEADFUL = "1" }
if ($MaxSesiones -gt 0) { $env:CAPTCHA_MAX_SESIONES = "$MaxSesiones" }
$serverMts = Join-Path $dir "server.mts"
$nodeMajor = [int](& node -e "console.log(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 22) { throw "Node ${nodeMajor}: se necesita Node 22.6+ (idealmente 24) para correr .mts nativo." }
$worker = Start-Process node -ArgumentList "`"$serverMts`"" -PassThru -NoNewWindow
Start-Sleep -Seconds 2
if ($worker.HasExited) { throw "El worker no arranco (revisa la consola)." }

# 5) Tunel + leer la URL
Write-Host "Abriendo Cloudflare quick tunnel..."
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $cf
$psi.Arguments = "tunnel --url http://localhost:$PORT --no-autoupdate"
$psi.RedirectStandardError = $true
$psi.RedirectStandardOutput = $true
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
if (-not $wssHost) {
  Stop-Process -Id $worker.Id -ErrorAction SilentlyContinue
  throw "No pude leer la URL de cloudflared."
}

Write-Host ""
Write-Host "===================================================================="
Write-Host " EN VERCEL -> Settings -> Environment Variables (Production + Preview):"
Write-Host ""
Write-Host "   NEXT_PUBLIC_CAPTCHA_WS_URL        = wss://$wssHost"
Write-Host "   NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN  = $TOKEN"
Write-Host ""
Write-Host " Y BORRAR (o poner en 'off'):  CAPTCHA_PROXIES"
Write-Host ""
Write-Host " Guardar -> Redeploy. Probar el captcha."
Write-Host " Headful: $($Headful.IsPresent)   Origin: $(if($Origin){$Origin}else{'(cualquiera)'})"
Write-Host ""
Write-Host " DEJA ESTA VENTANA ABIERTA. Ctrl+C para frenar todo."
Write-Host "===================================================================="

try { $cfp.WaitForExit() }
finally {
  Stop-Process -Id $worker.Id -ErrorAction SilentlyContinue
  if (-not $cfp.HasExited) { Stop-Process -Id $cfp.Id -ErrorAction SilentlyContinue }
  Write-Host "Worker y tunel detenidos."
}
