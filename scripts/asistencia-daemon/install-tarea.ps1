# Registra el daemon de asistencia como tarea de Windows que arranca al iniciar
# sesion y se reinicia sola si falla. Ejecutar UNA vez.
#
#   .\install-tarea.ps1 -Args "-AppUrl https://campusutn.dpdns.org -Name esta-pc"
#
# Quitar:  Unregister-ScheduledTask -TaskName CampusAsistenciaWorker -Confirm:$false
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

Register-ScheduledTask -TaskName "CampusAsistenciaWorker" -Action $action -Trigger $trigger `
  -Settings $settings -Force -RunLevel Highest | Out-Null

Write-Host "Tarea 'CampusAsistenciaWorker' registrada. Arranca al iniciar sesion de Windows."
Write-Host "Args: $Args"
Write-Host "Probar ahora:  Start-ScheduledTask -TaskName CampusAsistenciaWorker"
