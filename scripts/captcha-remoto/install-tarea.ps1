# Registra el worker como tarea de Windows que arranca al iniciar sesion y se
# reinicia sola si falla. Ejecutar UNA vez (PowerShell como admin recomendado).
#
#   .\install-tarea.ps1 -Args "-AppUrl https://campusutn.dpdns.org -Origin https://campusutn.dpdns.org -MaxSesiones 14 -MaxCola 60 -Pool 3"
#
# Quitar:  Unregister-ScheduledTask -TaskName CaptchaRemotoWorker -Confirm:$false
param([string]$Args = "")
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$start = Join-Path $dir "start.ps1"
if (-not (Test-Path $start)) { throw "No encuentro start.ps1 en $dir" }

$cmd = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$start`" $Args"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $cmd
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "CaptchaRemotoWorker" -Action $action -Trigger $trigger `
  -Settings $settings -Force -RunLevel Highest | Out-Null

Write-Host "Tarea 'CaptchaRemotoWorker' registrada. Arranca al iniciar sesion de Windows."
Write-Host "Args: $Args"
Write-Host ""
Write-Host "Para que la PC se recupere sola de un corte de luz sin login manual:"
Write-Host "  activa el inicio de sesion automatico (netplwiz -> destildar 'Los usuarios"
Write-Host "  deben escribir su nombre...') y dejala prendida."
Write-Host ""
Write-Host "Probar ahora:  Start-ScheduledTask -TaskName CaptchaRemotoWorker"
