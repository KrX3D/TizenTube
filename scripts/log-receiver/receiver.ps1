param(
  [int]$Port = 3030,
  [string]$OutputFile = "tv.log",
  [string]$SyslogForwardIp = "",      # Set to your syslog server IP to forward (e.g. "192.168.1.10")
  [int]$SyslogForwardPort = 514
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogPath   = Join-Path $ScriptDir $OutputFile

$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add("http://*:$Port/")
$Listener.Start()

Write-Host "Log receiver on http://*:$Port/tv-log  →  $LogPath"
if ($SyslogForwardIp) {
  Write-Host "Syslog forwarding: UDP $SyslogForwardIp`:$SyslogForwardPort"
  $UdpClient = [System.Net.Sockets.UdpClient]::new()
  $UdpClient.Connect($SyslogForwardIp, $SyslogForwardPort)
} else {
  Write-Host "Syslog forwarding: disabled  (use -SyslogForwardIp to enable)"
  $UdpClient = $null
}
Write-Host "Press Ctrl+C to stop."
Write-Host ""

function Format-LogEntry {
  param($Parsed)
  $lines = @()
  $lines += ""
  $lines += "─" * 72
  if ($Parsed._formatted) {
    # Use pre-formatted string from logger.js
    $lines += $Parsed._formatted
  } else {
    # Fallback for plain JSON payloads
    $ts  = if ($Parsed.ts)      { $Parsed.ts }      else { (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff") }
    $lvl = if ($Parsed.level)   { $Parsed.level }   else { "INFO" }
    $ctx = if ($Parsed.context) { $Parsed.context } else { "unknown" }
    $msg = if ($Parsed.message) { $Parsed.message } else { ($Parsed | ConvertTo-Json -Compress) }
    $lines += "[$ts] [$lvl] [$ctx] $msg"
    if ($Parsed.data) {
      $lines += "  data: $($Parsed.data | ConvertTo-Json -Compress)"
    }
  }
  return $lines -join "`n"
}

function Send-Syslog {
  param($Parsed, $UdpClient)
  if (-not $UdpClient) { return }
  try {
    $pri  = 134  # facility=local0 (16), severity=info (6) → (16*8)+6 = 134
    $ts   = if ($Parsed.ts) { $Parsed.ts } else { (Get-Date -Format "yyyy-MM-dd HH:mm:ss") }
    $host = "TizenTV"
    $app  = if ($Parsed.app) { $Parsed.app } else { "TizenYouTube" }
    $msg  = if ($Parsed.message) { $Parsed.message } else { ($Parsed | ConvertTo-Json -Compress) }
    $syslog = "<$pri>1 $ts $host $app - - - $msg"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($syslog)
    $UdpClient.Send($bytes, $bytes.Length) | Out-Null
  } catch {
    Write-Host "Syslog forward error: $_" -ForegroundColor DarkYellow
  }
}

try {
  while ($Listener.IsListening) {
    $Context  = $Listener.GetContext()
    $Request  = $Context.Request
    $Response = $Context.Response

    $Response.Headers.Add("Access-Control-Allow-Origin",  "*")
    $Response.Headers.Add("Access-Control-Allow-Methods", "POST, OPTIONS")
    $Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

    if ($Request.HttpMethod -eq 'OPTIONS') {
      $Response.StatusCode = 204
      $Response.Close()
      continue
    }

    if ($Request.HttpMethod -eq 'POST' -and $Request.Url.AbsolutePath -eq '/tv-log') {
      $Reader = [System.IO.StreamReader]::new($Request.InputStream, $Request.ContentEncoding)
      $Body   = $Reader.ReadToEnd()
      $Reader.Close()

      $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
      $Parsed    = $null
      try   { $Parsed = $Body | ConvertFrom-Json }
      catch { $Parsed = $null }

      if ($Parsed) {
        $Formatted = Format-LogEntry -Parsed $Parsed
        Add-Content -Path $LogPath -Value $Formatted
        Write-Host $Formatted -ForegroundColor Cyan
        Send-Syslog -Parsed $Parsed -UdpClient $UdpClient
      } else {
        $line = "[$Timestamp] $Body"
        Add-Content -Path $LogPath -Value $line
        Write-Host $line
      }

      $Response.StatusCode = 204
    } else {
      $Response.StatusCode = 404
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
      $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $Response.Close()
  }
} finally {
  $Listener.Stop()
  $Listener.Close()
  if ($UdpClient) { $UdpClient.Close() }
}
