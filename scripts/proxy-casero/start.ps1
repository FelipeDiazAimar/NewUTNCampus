# ─────────────────────────────────────────────────────────────────────────────
# Proxy casero para el captcha remoto.
#
# Levanta un proxy HTTP autenticado en 127.0.0.1 y lo expone a internet con
# bore (bore.pub). Vercel sale por ese túnel => Google ve la IP RESIDENCIAL de
# esta PC, no la de datacenter de Vercel.
#
# Uso:
#   1) Ejecutar este script.  (PowerShell, en esta carpeta:  .\start.ps1 )
#   2) Copiar el CAPTCHA_PROXIES que imprime -> Vercel -> Settings ->
#      Environment Variables (Production) -> pegar -> Save -> Redeploy.
#   3) DEJAR ESTA VENTANA ABIERTA. Si la cerrás, se cae el túnel.
#
# bore.pub asigna un puerto al azar cada arranque. Para que NO cambie (y no
# tener que editar la env var en cada reinicio), pasá uno fijo:
#   .\start.ps1 -RemotePort 33245
# bore.pub lo concede si está libre; si no, cae a uno al azar.
# ─────────────────────────────────────────────────────────────────────────────
#   .\start.ps1 -NoAuth        (proxy abierto, sin usuario/clave — para
#                               descartar el bug de Playwright con auth+CONNECT.
#                               Solo para probar; el bore.pub:PUERTO queda
#                               abierto a quien lo adivine.)
param([int]$RemotePort = 0, [switch]$NoAuth)
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$bin = Join-Path $dir "bin"
$credFile = Join-Path $dir "credentials.txt"
$LOCAL_PORT = 8787
New-Item -ItemType Directory -Force -Path $bin | Out-Null

# 1) Credenciales del proxy (se generan una sola vez y quedan en credentials.txt)
if ($NoAuth) {
  $USER = ""
  $PASS = ""
  Write-Host "MODO SIN AUTH (proxy abierto)."
} elseif (Test-Path $credFile) {
  $c = Get-Content $credFile
  $USER = (($c | Select-String '^user=') -split '=', 2)[1]
  $PASS = (($c | Select-String '^pass=') -split '=', 2)[1]
} else {
  $USER = "captcha"
  $chars = (48..57) + (65..90) + (97..122)
  $PASS = -join (1..24 | ForEach-Object { [char]($chars | Get-Random) })
  "user=$USER`npass=$PASS" | Set-Content $credFile -Encoding ascii
  Write-Host "Credenciales nuevas guardadas en credentials.txt"
}

# 2) Descargar bore.exe si falta
$bore = Join-Path $bin "bore.exe"
if (-not (Test-Path $bore)) {
  Write-Host "Descargando bore..."
  $hdr = @{ "User-Agent" = "proxy-casero" }
  $rel = Invoke-RestMethod "https://api.github.com/repos/ekzhang/bore/releases/latest" -Headers $hdr
  $asset = $rel.assets | Where-Object { $_.name -match "x86_64-pc-windows-msvc.*\.zip$" } | Select-Object -First 1
  if (-not $asset) { throw "No encontré el asset de bore para Windows" }
  $zip = Join-Path $bin "bore.zip"
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip -Headers $hdr
  Expand-Archive $zip -DestinationPath $bin -Force
  Remove-Item $zip
  if (-not (Test-Path $bore)) {
    $found = Get-ChildItem $bin -Recurse -Filter bore.exe | Select-Object -First 1
    if ($found) { Copy-Item $found.FullName $bore }
  }
  Write-Host "bore listo."
}

# 3) Arrancar el proxy local
$env:PROXY_PORT = "$LOCAL_PORT"
$env:PROXY_USER = $USER
$env:PROXY_PASS = $PASS
$proxyProc = Start-Process node -ArgumentList "`"$(Join-Path $dir 'proxy.mjs')`"" -PassThru -NoNewWindow
Start-Sleep -Seconds 1
if ($proxyProc.HasExited) { throw "El proxy no arrancó (¿node en el PATH?)" }

# 4) Abrir el túnel y leer el puerto público que asigna bore.pub
Write-Host "Abriendo tunel con bore.pub..."
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $bore
$boreArgs = "local $LOCAL_PORT --to bore.pub"
if ($RemotePort -gt 0) { $boreArgs += " --port $RemotePort" }
$psi.Arguments = $boreArgs
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$boreProc = [System.Diagnostics.Process]::Start($psi)

$remotePort = $null
for ($i = 0; $i -lt 40 -and -not $boreProc.HasExited; $i++) {
  $line = $boreProc.StandardOutput.ReadLine()
  if ($null -eq $line) { break }
  Write-Host "  bore: $line"
  $mm = [regex]::Match($line, "bore\.pub:(\d+)")
  if (-not $mm.Success) { $mm = [regex]::Match($line, "remote_port[=:\s]+(\d+)") }
  if ($mm.Success) { $remotePort = $mm.Groups[1].Value; break }
}
if (-not $remotePort) {
  Stop-Process -Id $proxyProc.Id -ErrorAction SilentlyContinue
  throw "No pude leer el puerto de bore. Salida de bore arriba."
}

if ($USER) { $val = "http://${USER}:${PASS}@bore.pub:$remotePort" }
else { $val = "http://bore.pub:$remotePort" }
Write-Host ""
Write-Host "======================================================================"
Write-Host " EN VERCEL -> Settings -> Environment Variables (Production):"
Write-Host ""
Write-Host "   CAPTCHA_PROXIES = $val"
Write-Host ""
Write-Host " Guardar -> Redeploy. Probar el captcha y mirar el panel Diagnostico:"
Write-Host "   proxy:ok {server: bore.pub:$remotePort}  -> salio por esta PC"
Write-Host ""
Write-Host " DEJA ESTA VENTANA ABIERTA. Ctrl+C para frenar todo."
Write-Host "======================================================================"

try {
  $boreProc.WaitForExit()
} finally {
  Stop-Process -Id $proxyProc.Id -ErrorAction SilentlyContinue
  if (-not $boreProc.HasExited) { Stop-Process -Id $boreProc.Id -ErrorAction SilentlyContinue }
  Write-Host "Proxy y tunel detenidos."
}
