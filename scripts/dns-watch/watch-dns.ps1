<#
    watch-dns.ps1 — catch the intermittent DNS failure that stalls playback.

    WHY THIS EXISTS

    Playback on the 6.5 TV stops with an empty buffer, and the service log says
    why a minute earlier:

      08:54:50  dns did not answer at all for www.youtube.com within 10001ms
      08:55:52  unwedge.starved {"at":153,"bufferedAhead":0,"readyState":2}

    Across the whole capture every starvation on that TV belongs to one of
    three such episodes, each beginning within a minute of a resolver that
    stopped answering. The TV cannot say more than that: its own watcher looks
    once a minute with a ten second timeout, so it sees an outage only if one
    happens to overlap a sample, and it cannot tell a resolver that is down
    from a network that is.

    This can. It runs on a PC on the same network, asks both resolvers plus a
    public control on every round, and writes a line only when something is
    wrong — so it can be left running for days and the file stays readable.

    WHAT IT TELLS YOU

      both resolvers fail, control fine   the resolvers are the problem
      everything fails                    the network or the route is
      only one resolver fails             that one, and the other is covering
      a cache-busting query is slow       forwarding upstream is the slow part,
                                          which is the path a new googlevideo
                                          hostname takes during playback

    The cache-busting query is the point of the whole thing. A repeat lookup of
    www.youtube.com is answered from the resolver's cache and says nothing
    about the path that actually breaks: when playback starts, the player
    resolves a googlevideo hostname it has never seen, which must be forwarded
    upstream. Those names are generated per session and cannot be used here, so
    a random label under a real domain stands in for one. It is expected to
    come back NXDOMAIN — what matters is that it comes back at all, and how
    fast.

    USAGE

      pwsh -File watch-dns.ps1
      pwsh -File watch-dns.ps1 -IntervalSeconds 10 -SlowMs 500
      pwsh -File watch-dns.ps1 -Servers 192.168.90.200,192.168.90.220 -Control 1.1.1.1

    Ctrl-C to stop; it prints a summary per server on the way out.
#>

[CmdletBinding()]
param(
    # The resolvers under test. These are the ones the TVs are configured with.
    [string[]]$Servers = @('192.168.90.200', '192.168.90.220'),

    # A resolver outside the house, to tell "my DNS is broken" from "my
    # internet is broken". Not used for anything else.
    [string]$Control = '1.1.1.1',

    [int]$IntervalSeconds = 20,

    # Above this, an answer is recorded as slow. The TV gives up at 10s, but a
    # resolver taking even one second is already long enough for a player that
    # needs the next segment now.
    [int]$SlowMs = 1000,

    [string]$LogPath = (Join-Path $PSScriptRoot 'dns-watch.log')
)

$ErrorActionPreference = 'Stop'

# Queried every round. The first is cached after the first round and measures
# the resolver itself; the second is new every time and measures forwarding.
$CachedName = 'www.youtube.com'
$RandomSuffix = 'youtube.com'

$stats = @{}
foreach ($s in @($Servers) + @($Control)) {
    $stats[$s] = [pscustomobject]@{
        Server = $s; Queries = 0; Failures = 0; Slow = 0; WorstMs = 0; TotalMs = 0
    }
}

function Write-Line {
    param([string]$Text)
    $stamped = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text
    Write-Output $stamped
    try { Add-Content -LiteralPath $LogPath -Value $stamped } catch { }
}

function Measure-Lookup {
    param([string]$Server, [string]$Name)

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        # QuickTimeout keeps one dead resolver from stalling the whole round.
        # DnsOnly avoids the local cache and NetBIOS, so each round really asks.
        $null = Resolve-DnsName -Name $Name -Server $Server -Type A -DnsOnly -QuickTimeout -ErrorAction Stop
        $sw.Stop()
        return [pscustomobject]@{ Ok = $true; Ms = $sw.ElapsedMilliseconds; Error = $null }
    } catch {
        $sw.Stop()
        $message = $_.Exception.Message
        # A random label under a real domain is MEANT not to exist. That is a
        # healthy answer, and the time it took is the measurement.
        $isNxDomain = $message -match 'DNS name does not exist|nicht vorhanden|DNS_ERROR_RCODE_NAME_ERROR'
        return [pscustomobject]@{ Ok = $isNxDomain; Ms = $sw.ElapsedMilliseconds; Error = $(if ($isNxDomain) { $null } else { $message }) }
    }
}

Write-Line ("watching {0} (control {1}) every {2}s; slow means over {3}ms; log {4}" -f `
    ($Servers -join ', '), $Control, $IntervalSeconds, $SlowMs, $LogPath)
Write-Line 'only problems are logged from here; Ctrl-C for a summary'

$round = 0
try {
    while ($true) {
        $round++
        # New every round, so the resolver has to forward it rather than
        # answer from cache — the path a fresh googlevideo hostname takes.
        $randomName = '{0:x}-tt.{1}' -f (Get-Random -Maximum 0x7FFFFFFF), $RandomSuffix
        $problems = @()
        $roundResults = @{}

        foreach ($server in @($Servers) + @($Control)) {
            $cached = Measure-Lookup -Server $server -Name $CachedName
            $fresh = Measure-Lookup -Server $server -Name $randomName
            $roundResults[$server] = [pscustomobject]@{ Cached = $cached; Fresh = $fresh }

            $stat = $stats[$server]
            foreach ($r in @($cached, $fresh)) {
                $stat.Queries++
                $stat.TotalMs += $r.Ms
                if ($r.Ms -gt $stat.WorstMs) { $stat.WorstMs = $r.Ms }
                if (-not $r.Ok) { $stat.Failures++ }
                elseif ($r.Ms -gt $SlowMs) { $stat.Slow++ }
            }

            if (-not $cached.Ok) { $problems += ('{0} FAILED {1}: {2}' -f $server, $CachedName, $cached.Error) }
            elseif ($cached.Ms -gt $SlowMs) { $problems += ('{0} slow {1}: {2}ms' -f $server, $CachedName, $cached.Ms) }

            if (-not $fresh.Ok) { $problems += ('{0} FAILED forwarding a new name: {1}' -f $server, $fresh.Error) }
            elseif ($fresh.Ms -gt $SlowMs) { $problems += ('{0} slow forwarding a new name: {1}ms' -f $server, $fresh.Ms) }
        }

        if ($problems.Count) {
            # Said once per round rather than per query, and with the verdict
            # attached, because the useful question is which side is at fault.
            $serversBad = @($Servers | Where-Object { -not $roundResults[$_].Cached.Ok -or -not $roundResults[$_].Fresh.Ok })
            $controlBad = (-not $roundResults[$Control].Cached.Ok) -or (-not $roundResults[$Control].Fresh.Ok)
            $verdict =
                if ($controlBad -and $serversBad.Count -eq @($Servers).Count) { 'the network or the route out, since the control failed too' }
                elseif ($serversBad.Count -eq @($Servers).Count) { 'BOTH resolvers, while the control answered' }
                elseif ($serversBad.Count) { ('{0}, while the other resolver answered' -f ($serversBad -join ' and ')) }
                else { 'slow rather than failing' }
            Write-Line ('round {0}: {1}  [{2}]' -f $round, ($problems -join ' | '), $verdict)
        }
        elseif ($round % 180 -eq 1) {
            # An hourly note at the default interval, so a quiet file is
            # distinguishable from a watcher that died.
            $summary = foreach ($server in @($Servers)) {
                '{0} {1}/{2}ms' -f $server, $roundResults[$server].Cached.Ms, $roundResults[$server].Fresh.Ms
            }
            Write-Line ('round {0}: all well ({1})' -f $round, ($summary -join ', '))
        }

        Start-Sleep -Seconds $IntervalSeconds
    }
} finally {
    Write-Line '--- summary ---'
    foreach ($server in @($Servers) + @($Control)) {
        $s = $stats[$server]
        if ($s.Queries -eq 0) { continue }
        $avg = [math]::Round($s.TotalMs / $s.Queries)
        Write-Line ('{0,-16} {1,5} queries  {2,4} failed  {3,4} slow  avg {4,5}ms  worst {5,6}ms{6}' -f `
            $server, $s.Queries, $s.Failures, $s.Slow, $avg, $s.WorstMs,
            $(if ($server -eq $Control) { '   (control)' } else { '' }))
    }
}
