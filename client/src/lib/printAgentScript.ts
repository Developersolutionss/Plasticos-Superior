/**
 * Puente de impresión: script de PowerShell (Windows 10/11, sin instalar nada
 * más) que corre en el PC de planta donde está conectada la impresora. Le
 * pregunta al servidor cada 2 segundos si hay etiquetas por imprimir y se
 * las manda a la impresora en crudo (ZPL), igual que la prueba que se hizo
 * con la SAT TT460. Se descarga desde Configuración → Impresoras con el
 * token de esa impresora ya puesto.
 *
 * Se mantiene en ASCII a propósito: PowerShell 5.1 lee mal un .ps1 con
 * tildes si no tiene BOM.
 */
export const AGENT_SCRIPT_NAME = "puente-impresion.ps1";
export const AGENT_INSTALLER_NAME = "instalar-puente.cmd";

function psString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function buildAgentScript(opts: { server: string; token: string; printerName: string }): string {
  return `# Puente de impresion de etiquetas - Plasticos Superior
# Recoge las etiquetas que se piden desde los celulares y las manda a la
# impresora termica. No editar el token: si se pierde, generar uno nuevo en
# Configuracion -> Impresoras y volver a descargar este archivo.
param([switch]$Instalar, [switch]$Desinstalar)

$Servidor  = ${psString(opts.server.replace(/\/+$/, ""))}
$Token     = ${psString(opts.token)}
$Impresora = ${psString(opts.printerName)}
$Tarea     = 'Puente de impresion de etiquetas'

$Script = $MyInvocation.MyCommand.Path
$Carpeta = Split-Path -Parent $Script
$Log = Join-Path $Carpeta 'puente-impresion.log'

if ($Instalar) {
  $accion  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Script + '"')
  $inicio  = New-ScheduledTaskTrigger -AtStartup
  $quien   = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $Tarea -Action $accion -Trigger $inicio -Principal $quien -Settings $ajustes -Force | Out-Null
  Stop-ScheduledTask -TaskName $Tarea -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName $Tarea
  Write-Host ''
  Write-Host 'LISTO: el puente quedo instalado y corriendo.' -ForegroundColor Green
  Write-Host 'Arranca solo cada vez que se prende este PC. Registro: ' $Log
  return
}
if ($Desinstalar) {
  Stop-ScheduledTask -TaskName $Tarea -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $Tarea -Confirm:$false
  Write-Host 'Puente desinstalado.'
  return
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Escribir([string]$msg) {
  $linea = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg
  try {
    if ((Test-Path $Log) -and ((Get-Item $Log).Length -gt 1MB)) { Move-Item $Log ($Log + '.1') -Force }
    Add-Content -Path $Log -Value $linea -Encoding UTF8
  } catch { }
  Write-Host $linea
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static string Send(string printer, byte[] data, string docName) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "No se encontro la impresora '" + printer + "' (error " + Marshal.GetLastWin32Error() + ")";
    try {
      var di = new DOCINFO { pDocName = docName, pDataType = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) return "La impresora no acepto el trabajo (error " + Marshal.GetLastWin32Error() + ")";
      StartPagePrinter(h);
      int w; bool ok = WritePrinter(h, data, data.Length, out w);
      EndPagePrinter(h); EndDocPrinter(h);
      return ok ? "OK" : ("Fallo al enviar a la impresora (error " + Marshal.GetLastWin32Error() + ")");
    } finally { ClosePrinter(h); }
  }
}
"@

$headers = @{ Authorization = 'Bearer ' + $Token }
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Enviar([string]$ruta, $datos) {
  $cuerpo = $utf8.GetBytes(($datos | ConvertTo-Json -Compress))
  return Invoke-RestMethod -Method Post -Uri ($Servidor + $ruta) -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $cuerpo -TimeoutSec 25
}

Escribir ('Puente iniciado: ' + $Servidor + ' -> ' + $Impresora)
$espera = 2
while ($true) {
  try {
    $r = Enviar '/api/print-agent/poll' @{ hostname = $env:COMPUTERNAME; printer = $Impresora }
    foreach ($job in @($r.jobs)) {
      if ($null -eq $job) { continue }
      $res = [RawPrinter]::Send($Impresora, $utf8.GetBytes([string]$job.zpl), ('Etiqueta ' + $job.description))
      if ($res -eq 'OK') { $datos = @{ ok = $true } } else { $datos = @{ ok = $false; error = $res } }
      Enviar ('/api/print-agent/jobs/' + $job.id + '/result') $datos | Out-Null
      Escribir ('Trabajo ' + $job.id + ' (' + $job.description + '): ' + $res)
    }
    $espera = 2
  } catch {
    Escribir ('Sin conexion con el servidor: ' + $_.Exception.Message)
    $espera = [Math]::Min(30, $espera * 2)
  }
  Start-Sleep -Seconds $espera
}
`.replace(/\r?\n/g, "\r\n");
}

/** Instalador: doble clic, pide permiso de administrador y deja el puente como tarea al arrancar. */
export function buildInstallerCmd(): string {
  return `@echo off
echo Instalando el puente de impresion de etiquetas...
echo (Windows va a pedir permiso de administrador: acepta.)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','%~dp0${AGENT_SCRIPT_NAME}','-Instalar'"
`.replace(/\r?\n/g, "\r\n");
}

/** Descarga un texto como archivo. */
export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
