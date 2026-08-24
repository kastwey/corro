<#
.SYNOPSIS
    Stamps a release with the date it was built and which update of that day it is.

.DESCRIPTION
    Corro ships continuously: there is no release train and no semantic version to bump, so a
    number like 2.4.1 would say nothing true. What a player actually wants to know is WHEN the
    thing in front of them was last updated, and a date says that directly.

    The stamp is `<yyyyMMdd>-<NNN>`, for example 20260823-001: the UTC day the commit was made,
    and its ordinal within that day counted over the commits reachable from it. The ordinal
    exists because a day can carry several updates and "today" would then be ambiguous; it is
    derived from the repository itself rather than from a build counter, so the same commit
    always produces the same stamp no matter who builds it or how often.

    The output is a configuration fragment for the server (see BuildInfoOptions), written next to
    the published application as buildinfo.json. A build that does not run this script simply has
    no stamp, and the lobby then shows no version at all — which is the right answer for a clone
    somebody is running from source.

.PARAMETER Sha
    The commit to stamp. Defaults to HEAD.

.PARAMETER RepositoryUrl
    Where the commit can be read. Defaults to the `origin` remote, normalized to an https URL.
    Anything that cannot be expressed as https is dropped: the dialog then states the version
    without offering a link to nowhere.

.PARAMETER RepositoryRoot
    The working tree to read. Defaults to the repository this script lives in.

.PARAMETER Timestamp
    When this build is going live, recorded as the deployment time. Defaults to now, and exists
    so the tests can pin it.

.PARAMETER OutputPath
    Where to write the fragment. Without it the JSON is only written to standard output.

.EXAMPLE
    pwsh -File tools/build-version.ps1 -Sha $GITHUB_SHA -OutputPath publish/buildinfo.json
#>
[CmdletBinding()]
param(
    [string]$Sha = 'HEAD',
    [string]$RepositoryUrl,
    [string]$RepositoryRoot,
    [DateTimeOffset]$Timestamp = [DateTimeOffset]::UtcNow,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if (-not $RepositoryRoot) { $RepositoryRoot = Split-Path -Parent $PSScriptRoot }

function Invoke-Git {
    # The arguments arrive as one array rather than as loose words: git options start with a dash,
    # and PowerShell would read some of them as parameters of this function instead.
    param([string[]]$Arguments)
    $output = & git -C $RepositoryRoot @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed: $output"
    }
    return ($output | Out-String).Trim()
}

# A shallow clone knows only the tip, so every commit would look like the first of its day. Fail
# loudly rather than stamping every release -001: a wrong ordinal is worse than a missing one,
# because it looks like an answer. CI checks out with fetch-depth 0 for exactly this reason.
if ((Invoke-Git @('rev-parse', '--is-shallow-repository')) -eq 'true') {
    throw 'Cannot stamp a build from a shallow clone: check out the full history (fetch-depth: 0).'
}

$commit = Invoke-Git @('rev-parse', '--verify', "$Sha^{commit}")
$committed = [DateTimeOffset]::Parse(
    (Invoke-Git @('show', '-s', '--format=%cI', $commit)),
    [cultureinfo]::InvariantCulture).ToUniversalTime()

# The ordinal counts the commits of that UTC day that this one is built on top of — its own
# ancestors, not everything that happens to share the date. Two properties come out of that: a
# commit is always inside its own window, so the count is never zero; and the ordinal always grows
# along a chain, even where history is not in timestamp order (a rebase, or a branch merged after
# a later commit was already made), because an ancestor can only ever reach fewer commits.
$dayStart = [DateTimeOffset]::new($committed.Date, [TimeSpan]::Zero)
$dayEnd = $dayStart.AddDays(1).AddSeconds(-1)
$gitInstant = { param([DateTimeOffset]$value) $value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") }
$ordinal = [int](Invoke-Git @(
        'rev-list', '--count',
        "--since=$(& $gitInstant $dayStart)",
        "--until=$(& $gitInstant $dayEnd)",
        $commit))
if ($ordinal -lt 1) {
    throw "Could not count the updates of $($committed.ToString('yyyy-MM-dd')) up to $commit."
}

# Three digits reads as a sequence rather than as a number; a day that somehow needs a fourth
# simply grows, because dropping a digit would repeat a stamp.
$version = '{0:yyyyMMdd}-{1:000}' -f $committed.UtcDateTime, $ordinal

if (-not $RepositoryUrl) {
    $remote = & git -C $RepositoryRoot remote get-url origin 2>&1
    if ($LASTEXITCODE -eq 0) { $RepositoryUrl = ($remote | Out-String).Trim() }
}

# Only an https URL is kept. A commit link is opened in the player's browser, so a git@ or ssh://
# remote is not something to hand them; the common GitHub form is converted, anything else drops.
if ($RepositoryUrl -match '^git@([^:]+):(.+)$') { $RepositoryUrl = "https://$($Matches[1])/$($Matches[2])" }
if ($RepositoryUrl -match '^ssh://git@([^/]+)/(.+)$') { $RepositoryUrl = "https://$($Matches[1])/$($Matches[2])" }
if ($RepositoryUrl) { $RepositoryUrl = $RepositoryUrl -replace '\.git$', '' }
if ($RepositoryUrl -and $RepositoryUrl -notmatch '^https://') { $RepositoryUrl = $null }

$build = [ordered]@{
    Version    = $version
    Commit     = $commit
    DeployedAt = & $gitInstant $Timestamp
}
if ($RepositoryUrl) { $build['RepositoryUrl'] = $RepositoryUrl }

$json = [ordered]@{ Build = $build } | ConvertTo-Json -Depth 3

if ($OutputPath) {
    $directory = Split-Path -Parent $OutputPath
    if ($directory -and -not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    Set-Content -LiteralPath $OutputPath -Value $json -Encoding utf8NoBOM
}

$json
