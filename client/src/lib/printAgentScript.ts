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

/**
 * Texto como expresión de PowerShell que no depende de cómo se lea el
 * archivo: lo ASCII va entre comillas simples y todo lo demás (tildes, ñ,
 * comillas tipográficas, que PowerShell 5.1 también toma como comillas)
 * como [char]0x.... Así un nombre de impresora con "ñ" ni se corrompe ni
 * puede cerrar la cadena e inyectar código.
 */
export function psString(s: string): string {
  const parts: string[] = [];
  let ascii = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) {
      ascii += ch === "'" ? "''" : ch;
    } else {
      if (ascii) parts.push(`'${ascii}'`);
      ascii = "";
      if (code <= 0xffff) parts.push(`[char]0x${code.toString(16).padStart(4, "0")}`);
    }
  }
  if (ascii || parts.length === 0) parts.push(`'${ascii}'`);
  return parts.length === 1 ? parts[0] : `(${parts.join(" + ")})`;
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
  # La tarea corre como SYSTEM y el archivo lleva la clave de la impresora:
  # solo Administradores y SYSTEM pueden leer o cambiar esta carpeta.
  icacls $Carpeta /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
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
      # Cada etiqueta por separado: si falla una (o el aviso de una), las
      # demas del lote se imprimen igual.
      try {
        $res = [RawPrinter]::Send($Impresora, $utf8.GetBytes([string]$job.zpl), ('Etiqueta ' + $job.description))
        if ($res -eq 'OK') { $datos = @{ ok = $true } } else { $datos = @{ ok = $false; error = $res } }
        Escribir ('Trabajo ' + $job.id + ' (' + $job.description + '): ' + $res)
        Enviar ('/api/print-agent/jobs/' + $job.id + '/result') $datos | Out-Null
      } catch {
        Escribir ('Trabajo ' + $job.id + ': no se pudo avisar el resultado: ' + $_.Exception.Message)
      }
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
export function downloadText(filename: string, content: string, opts?: { bom?: boolean }) {
  // Con BOM, PowerShell 5.1 lee el .ps1 como UTF-8 y no como ANSI.
  const blob = new Blob([opts?.bom ? "\uFEFF" + content : content], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
