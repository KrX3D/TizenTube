<#
.SYNOPSIS
  Removes old @krx3d/tizentube2 versions from npm.

.DESCRIPTION
  The publish workflow attempts this on every run and cannot succeed. npm
  removed legacy tokens in November 2025, so a granular access token is the only
  kind left, and since August 2026 one with bypass-2FA is refused for sensitive
  actions — unpublish among them. CI has no way to answer a 2FA challenge, so
  removal has to happen from a machine where someone can type a code.

  This does that, with the guard rails the workflow learned the hard way:

    - the version npm's `latest` tag points at is never touched, nor is any
      other dist-tag target
    - nothing is removed without showing the list and asking first
    - one 2FA code covers the whole batch, since npm accepts --otp per command
      and a code stays valid for its whole window

  npm only allows unpublishing a version within 72 hours of its publication, so
  anything older is listed and skipped rather than attempted. Those stay on the
  registry as deprecated versions, which is all the workflow can do to them.

.PARAMETER Package
  The npm package name. Defaults to this repo's package.

.PARAMETER Keep
  Extra versions to leave alone, on top of every dist-tag target.

.PARAMETER IncludeOlder
  Also attempt versions outside npm's 72-hour window. npm usually refuses
  these, but a refused request changes nothing, so it costs only the
  attempt — and it does sometimes go through for a package nothing depends
  on. Off by default so the normal run stays quiet.

.PARAMETER WhatIf
  List what would be removed and stop.

.EXAMPLE
  .\unpublish-old-versions.ps1 -WhatIf

.EXAMPLE
  .\unpublish-old-versions.ps1 -Keep 1.30.40
#>
param(
  [string]$Package = '@krx3d/tizentube2',
  [string[]]$Keep = @(),
  [int]$WindowHours = 72,
  [switch]$IncludeOlder,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

function Get-Packument {
  param([string]$Name)
  # Read the registry directly. `npm view` has its own HTTP cache, and a stale
  # answer here means acting on a version list that is no longer true.
  $url = "https://registry.npmjs.org/$Name"
  try {
    return Invoke-RestMethod -Uri $url -Method Get -Headers @{ Accept = 'application/json' }
  } catch {
    throw "Could not read $url : $($_.Exception.Message)"
  }
}

Write-Host "Reading the registry for $Package ..."
$doc = Get-Packument -Name $Package

$live = @($doc.versions.PSObject.Properties.Name)
if (-not $live -or $live.Count -eq 0) { throw "No live versions found for $Package." }

# Every dist-tag target is protected, not just latest: installing a tag npm
# hands out must keep working.
$tagTargets = @($doc.'dist-tags'.PSObject.Properties | ForEach-Object { $_.Value })
$protected = @($tagTargets + $Keep) | Where-Object { $_ } | Sort-Object -Unique

Write-Host ""
Write-Host "Live versions:  $($live.Count)"
Write-Host "Protected:      $($protected -join ', ')"
Write-Host ""

$now = [DateTime]::UtcNow
$removable = @()
$tooOld = @()

foreach ($v in $live) {
  if ($protected -contains $v) { continue }
  $stamp = $doc.time.PSObject.Properties[$v]
  if (-not $stamp) { $tooOld += $v; continue }
  # Invoke-RestMethod converts an ISO timestamp into a DateTime on its own,
  # but only sometimes — and re-parsing the result fails outright under a
  # non-US culture, where it renders as MM/dd/yyyy and Parse then rejects it.
  # So take a DateTime as-is and parse a string as invariant UTC.
  $raw = $stamp.Value
  if ($raw -is [DateTime]) {
    $published = $raw.ToUniversalTime()
  } else {
    $styles = [System.Globalization.DateTimeStyles]::AdjustToUniversal -bor [System.Globalization.DateTimeStyles]::AssumeUniversal
    $published = [DateTime]::Parse([string]$raw, [System.Globalization.CultureInfo]::InvariantCulture, $styles)
  }
  $age = ($now - $published).TotalHours
  if ($age -le $WindowHours) {
    $removable += [pscustomobject]@{ Version = $v; AgeHours = [math]::Round($age, 1) }
  } elseif ($IncludeOlder) {
    $removable += [pscustomobject]@{ Version = $v; AgeHours = [math]::Round($age, 1) }
  } else {
    $tooOld += $v
  }
}

if ($tooOld.Count -gt 0) {
  Write-Host "Outside npm's $WindowHours-hour window, so they cannot be removed ($($tooOld.Count)):" -ForegroundColor DarkGray
  Write-Host "  $($tooOld -join ', ')" -ForegroundColor DarkGray
  Write-Host "  Pass -IncludeOlder to attempt them anyway." -ForegroundColor DarkGray
  Write-Host ""
}

if ($removable.Count -eq 0) {
  Write-Host "Nothing to remove." -ForegroundColor Green
  return
}

if ($IncludeOlder) {
  Write-Host "To attempt ($($removable.Count)), including versions npm will probably refuse:" -ForegroundColor Yellow
} else {
  Write-Host "Can be removed ($($removable.Count)):" -ForegroundColor Yellow
}
$removable | Format-Table -AutoSize | Out-String | Write-Host

if ($WhatIf) {
  Write-Host "-WhatIf given, so nothing was changed." -ForegroundColor Cyan
  return
}

$answer = Read-Host "Remove these $($removable.Count) versions from npm? (type 'yes')"
if ($answer -ne 'yes') {
  Write-Host "Cancelled; nothing was changed." -ForegroundColor Cyan
  return
}

# One code for the batch. npm accepts --otp on each command and the code stays
# valid for its window, so this asks once rather than once per version.
$otp = Read-Host "Two-factor code from your authenticator"
if (-not $otp) {
  Write-Host "No code given; nothing was changed." -ForegroundColor Cyan
  return
}

$removed = 0
$failed = @()

foreach ($item in $removable) {
  $spec = "$Package@$($item.Version)"
  Write-Host ""
  Write-Host "Unpublishing $spec ..."
  $output = & npm unpublish $spec --otp $otp 2>&1
  if ($LASTEXITCODE -eq 0) {
    $removed++
    Write-Host "  removed" -ForegroundColor Green
  } else {
    $failed += $item.Version
    Write-Host ($output | Out-String).Trim() -ForegroundColor Red
    if (($output | Out-String) -match 'one-time pass|EOTP|invalid otp') {
      # A stale code fails every remaining version the same way; stop and let
      # the next run start from a fresh one rather than burning through the list.
      Write-Host ""
      Write-Host "The code was rejected. Run this again with a fresh one." -ForegroundColor Yellow
      break
    }
  }
}

Write-Host ""
Write-Host "Removed $removed of $($removable.Count)."
if ($failed.Count -gt 0) {
  Write-Host "Still present: $($failed -join ', ')" -ForegroundColor Yellow
}
Write-Host "A removed version number can never be published again, so the next" -ForegroundColor DarkGray
Write-Host "build continues from where the bump left off." -ForegroundColor DarkGray
