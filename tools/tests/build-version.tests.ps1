$ErrorActionPreference = 'Stop'

function Assert-Equal {
    param($Expected, $Actual, [string]$Because)
    if ($Expected -ne $Actual) {
        throw "Assertion failed ($Because). Expected '$Expected', got '$Actual'."
    }
}

function Assert-True {
    param([bool]$Actual, [string]$Because)
    Assert-Equal $true $Actual $Because
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script = Join-Path $root 'tools/build-version.ps1'
Assert-True (Test-Path -LiteralPath $script -PathType Leaf) 'the build stamp script is where CI expects it'

# A throwaway repository with commits at chosen instants. The stamp is a fact about history, so
# the only honest way to test it is against a real history.
$workspace = Join-Path ([IO.Path]::GetTempPath()) ("corro-build-version-" + [Guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $workspace | Out-Null

function Invoke-Git {
    # One array, not loose words: git options start with a dash and PowerShell would otherwise
    # read some of them (-A among them) as parameters of this function.
    param([string]$Directory, [string[]]$Arguments)
    $output = & git -C $Directory @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $output" }
    return ($output | Out-String).Trim()
}

function Add-Commit {
    param([string]$Directory, [string]$Message, [string]$Instant)
    Set-Content -LiteralPath (Join-Path $Directory 'log.txt') -Value $Message
    Invoke-Git $Directory @('add', '-A') | Out-Null
    $env:GIT_AUTHOR_DATE = $Instant
    $env:GIT_COMMITTER_DATE = $Instant
    try {
        Invoke-Git $Directory @('commit', '-m', $Message) | Out-Null
    } finally {
        Remove-Item Env:GIT_AUTHOR_DATE, Env:GIT_COMMITTER_DATE -ErrorAction SilentlyContinue
    }
    return Invoke-Git $Directory @('rev-parse', 'HEAD')
}

function Get-StampJson {
    param([string]$Sha, [hashtable]$Extra = @{})
    $arguments = @{
        Sha            = $Sha
        RepositoryRoot = $workspace
        Timestamp      = [DateTimeOffset]::Parse('2026-08-24T09:15:30+02:00')
    }
    foreach ($pair in $Extra.GetEnumerator()) { $arguments[$pair.Key] = $pair.Value }
    return (& $script @arguments | Out-String)
}

function Get-Stamp {
    param([string]$Sha, [hashtable]$Extra = @{})
    return (Get-StampJson $Sha $Extra | ConvertFrom-Json).Build
}

try {
    Invoke-Git $workspace @('init', '--initial-branch=main') | Out-Null
    Invoke-Git $workspace @('config', 'user.email', 'stamp@corro.invalid') | Out-Null
    Invoke-Git $workspace @('config', 'user.name', 'Stamp Test') | Out-Null

    # Several updates on one UTC day and one on the next. Two of them are deliberately awkward:
    # `late` was made after midnight in its own time zone but is still the 23rd in UTC, and it
    # carries an EARLIER instant than the commit it is built on, the way a rebase or a late merge
    # leaves history out of timestamp order.
    $first = Add-Commit $workspace 'first' '2026-08-23T08:00:00+00:00'
    $second = Add-Commit $workspace 'second' '2026-08-23T16:45:00+00:00'
    $thirdSameDay = Add-Commit $workspace 'third' '2026-08-23T23:59:59+00:00'
    $lateLocal = Add-Commit $workspace 'late' '2026-08-24T02:30:00+03:00'
    $nextDay = Add-Commit $workspace 'next' '2026-08-24T07:10:00+00:00'
    # Exactly midnight: the day's window starts on this instant, and git's own filters have to
    # include it. If they did not, the ordinal would come out zero and the script would refuse to
    # stamp a release made in that one second.
    $midnight = Add-Commit $workspace 'midnight' '2026-08-25T00:00:00+00:00'

    Assert-Equal '20260823-001' (Get-Stamp $first).Version 'the first update of a day is 001'
    Assert-Equal '20260823-002' (Get-Stamp $second).Version 'the second update of the same day is 002'
    Assert-Equal '20260823-003' (Get-Stamp $thirdSameDay).Version 'the last minute of the day still belongs to it'
    Assert-Equal '20260823-004' (Get-Stamp $lateLocal).Version 'a local time after midnight is dated by its UTC day'
    Assert-Equal '20260824-001' (Get-Stamp $nextDay).Version 'a new day starts counting again'
    Assert-Equal '20260825-001' (Get-Stamp $midnight).Version 'a commit made exactly at midnight opens its own day'

    # The stamp is a fact about the commit, not about when somebody happened to build it.
    Assert-Equal '20260823-002' (Get-Stamp $second @{ Timestamp = [DateTimeOffset]::Parse('2027-01-01T00:00:00Z') }).Version `
        'rebuilding the same commit later produces the same stamp'

    Assert-Equal $second (Get-Stamp $second).Commit 'the stamp names the commit it was built from'
    # Asserted on the JSON text rather than on the parsed object, because the deployment time is
    # read by a browser: the server hands it over as written and the dialog formats it in the
    # reader's own time zone, so what matters is that the file says one unambiguous UTC instant.
    Assert-True ((Get-StampJson $second).Contains('"DeployedAt": "2026-08-24T07:15:30Z"')) `
        'the deployment time is recorded as a UTC instant'

    # Where the commit can be read. Only https survives, because the link is opened in a browser.
    Assert-Equal 'https://github.com/kastwey/corro' `
        (Get-Stamp $second @{ RepositoryUrl = 'https://github.com/kastwey/corro' }).RepositoryUrl `
        'an https remote is kept as it is'
    Assert-Equal 'https://github.com/kastwey/corro' `
        (Get-Stamp $second @{ RepositoryUrl = 'git@github.com:kastwey/corro.git' }).RepositoryUrl `
        'an SSH remote is converted to the address a browser can open'
    Assert-Equal $null (Get-Stamp $second @{ RepositoryUrl = 'file:///srv/git/corro' }).RepositoryUrl `
        'a remote nobody can open is dropped rather than offered as a dead link'

    # A stamp that is not written anywhere is not a release: CI hands the file to the publish output.
    $outputPath = Join-Path $workspace 'out/buildinfo.json'
    Get-Stamp $second @{ OutputPath = $outputPath } | Out-Null
    Assert-True (Test-Path -LiteralPath $outputPath -PathType Leaf) 'the fragment is written where it was asked for'
    $written = (Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json).Build
    Assert-Equal '20260823-002' $written.Version 'the written fragment carries the stamp under its Build section'

    # A shallow clone knows only the tip, so every release would claim to be the first of its day.
    $shallow = Join-Path $workspace 'shallow'
    Invoke-Git $workspace @('clone', '--depth', '1', '--no-local', ("file://" + $workspace.Replace([char]92, [char]47)), $shallow) | Out-Null
    $failure = $null
    try {
        & $script -RepositoryRoot $shallow | Out-Null
    } catch {
        $failure = $_.Exception.Message
    }
    Assert-True ($null -ne $failure -and $failure.Contains('shallow')) `
        'a shallow clone refuses to stamp instead of stamping every release 001'
} finally {
    Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Build version stamp: all tests passed.'
