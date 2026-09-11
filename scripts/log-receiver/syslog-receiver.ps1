<#
.SYNOPSIS
  Minimal UDP syslog receiver for TizenTube's syslog output.

.DESCRIPTION
  TizenTube's "Syslog Server" setting sends RFC 5424 frames over UDP. The other
  script in this folder, receiver.ps1, is an HTTP listener for the "Remote Log
  Server" setting instead — it does not speak syslog, so pointing the syslog
  setting at it produces nothing at all. This is the missing half.

  Nothing here is required if you already run a syslog daemon (rsyslog, nxlog,
  Kiwi, Graylog, ...). Point the TV at that instead; this exists so syslog can
  be tried without installing one.

.PARAMETER Port
  UDP port to listen on. Must match the Syslog Port in TizenTube's settings.
  514 is the RFC-assigned default.

.PARAMETER OutputFile
  Written next to this script. Frames are appended, never truncated.

.PARAMETER Raw
  Print frames exactly as received instead of splitting out the header fields.

.EXAMPLE
  .\syslog-receiver.ps1
  .\syslog-receiver.ps1 -Port 1514 -Raw
#>
param(
  [int]$Port = 514,
  [string]$OutputFile = "tv-syslog.log",
  [switch]$Raw
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogPath   = Join-Path $ScriptDir $OutputFile

# RFC 5424 severities, for turning the PRI number back into something readable.
$Severities = @('EMERG', 'ALERT', 'CRIT', 'ERROR', 'WARN', 'NOTICE', 'INFO', 'DEBUG')

try {
  $EndPoint = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, $Port)
  $Client   = [System.Net.Sockets.UdpClient]::new($EndPoint)
} catch {
  Write-Host "Could not listen on UDP $Port : $($_.Exception.Message)" -ForegroundColor Red
  if ($Port -lt 1024) {
    Write-Host "Ports below 1024 can be taken by other services. Try -Port 1514 and set the same port in TizenTube." -ForegroundColor Yellow
  }
  exit 1
}

Write-Host "Syslog receiver on UDP *:$Port  ->  $LogPath" -ForegroundColor Green
Write-Host "In TizenTube: Miscellaneous -> Syslog Server -> set the IP to this PC, Port to $Port, then Enable Syslog Output." -ForegroundColor Cyan
Write-Host "If nothing arrives, allow inbound UDP $Port through Windows Firewall - it is blocked silently by default." -ForegroundColor Yellow
Write-Host "Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

$Sender = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, 0)

try {
  while ($true) {
    $Bytes = $Client.Receive([ref]$Sender)
    $Frame = [System.Text.Encoding]::UTF8.GetString($Bytes)
    Add-Content -Path $LogPath -Value $Frame

    if ($Raw) {
      Write-Host $Frame
      continue
    }

    # <PRI>VERSION TIMESTAMP HOSTNAME APP PROCID MSGID STRUCTURED-DATA MSG
    # MSGID carries the log label, which is the useful part to see at a glance.
    if ($Frame -match '^<(\d{1,3})>\d+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(?:\[[^\]]*\]|-)\s*(.*)$') {
      $Pri      = [int]$Matches[1]
      $Severity = $Severities[$Pri % 8]
      $Facility = [math]::Floor($Pri / 8)
      $Stamp    = $Matches[2]
      $Host_    = $Matches[3]
      $MsgId    = $Matches[6]
      $Message  = $Matches[7]

      $Colour = switch ($Severity) {
        'ERROR'  { 'Red' }
        'CRIT'   { 'Red' }
        'WARN'   { 'Yellow' }
        'DEBUG'  { 'DarkGray' }
        default  { 'Gray' }
      }
      Write-Host ("[{0}] [{1}] [{2}] {3} {4}" -f $Stamp, $Severity, $Host_, $MsgId, $Message) -ForegroundColor $Colour
      if ($Facility -ne 16) { Write-Host ("    facility {0}" -f $Facility) -ForegroundColor DarkGray }
    } else {
      # Not a frame this script understands; show it rather than hide it.
      Write-Host "(unparsed) $Frame" -ForegroundColor DarkYellow
    }
  }
} finally {
  $Client.Close()
}
