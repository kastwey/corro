# The hidden packages reach a working tree through links, and the linker has three jobs: link
# every package of the private clone, run without one at all, and never destroy a real folder
# that sits where a link should go. Each is exercised on a throwaway tree.

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

$tools = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $tools
$linker = Join-Path $tools 'link-hidden-packages.ps1'
$devScript = Join-Path $tools 'dev.ps1'
$sessionStart = Join-Path $root '.claude/hooks/session-start.sh'
$sandbox = Join-Path ([IO.Path]::GetTempPath()) ('corro-hidden-link-test-' + [Guid]::NewGuid().ToString('N'))
$engine = Join-Path $sandbox 'corro'
$packages = Join-Path $engine 'server/Packages'
$clone = Join-Path $sandbox 'corro-hidden-packages'

function New-Package {
    param([string]$Root, [string]$Name)
    New-Item -ItemType Directory -Path (Join-Path $Root $Name) -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $Root "$Name/manifest.json") -Value "{ `"id`": `"$Name`" }"
}

try {
    New-Item -ItemType Directory -Path $packages -Force | Out-Null
    New-Package $packages 'committed'

    # ── No clone: not an error, and the committed packages are untouched ──────────
    & $linker -RepositoryRoot $engine -Source (Join-Path $sandbox 'nowhere') | Out-Null
    Assert-Equal 0 $LASTEXITCODE 'a missing clone is not a failure'
    Assert-Equal 1 @(Get-ChildItem -LiteralPath $packages -Directory).Count 'nothing was linked from a missing clone'

    # ── The sibling clone is the default source, and only package folders are linked ──
    New-Package $clone 'hidden-one'
    New-Package $clone 'hidden-two'
    New-Item -ItemType Directory -Path (Join-Path $clone '.github') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $clone 'README.md') -Value 'not a package'

    & $linker -RepositoryRoot $engine | Out-Null
    $names = @(Get-ChildItem -LiteralPath $packages -Directory | Sort-Object Name | ForEach-Object Name)
    Assert-Equal 'committed,hidden-one,hidden-two' ($names -join ',') 'every package of the sibling clone is linked and nothing else'
    $link = Get-Item -LiteralPath (Join-Path $packages 'hidden-one') -Force
    Assert-True ([bool]$link.LinkType) 'a hidden package is a link, not a copy'
    Assert-True (Test-Path -LiteralPath (Join-Path $packages 'hidden-one/manifest.json')) 'the link resolves to the package contents'

    # ── Idempotent: a second run changes nothing, and an edit shows through the link ──
    & $linker -RepositoryRoot $engine | Out-Null
    Assert-Equal 3 @(Get-ChildItem -LiteralPath $packages -Directory).Count 'a repeated run links nothing twice'
    Set-Content -LiteralPath (Join-Path $clone 'hidden-two/help.en.md') -Value '# edited in the clone'
    Assert-True (Test-Path -LiteralPath (Join-Path $packages 'hidden-two/help.en.md')) 'an edit in the clone is visible through the link'

    # ── A real folder in the way is kept, never replaced ────────────────────────────
    New-Package $clone 'committed'
    & $linker -RepositoryRoot $engine 3>$null | Out-Null
    $real = Get-Item -LiteralPath (Join-Path $packages 'committed') -Force
    Assert-True (-not $real.LinkType) 'a real folder with a hidden package''s name is left untouched'

    # ── An explicit source, and a link that points at an old clone is repointed ─────
    $moved = Join-Path $sandbox 'moved-clone'
    New-Package $moved 'hidden-one'
    Set-Content -LiteralPath (Join-Path $moved 'hidden-one/marker.txt') -Value 'moved'
    & $linker -RepositoryRoot $engine -Source $moved | Out-Null
    Assert-True (Test-Path -LiteralPath (Join-Path $packages 'hidden-one/marker.txt')) 'a link is repointed at the clone given as source'

    # ── Every path that prepares a working tree links the packages ─────────────────
    # Anchored on lines that RUN the linker, so naming it in a comment cannot satisfy these.
    $devSource = Get-Content -LiteralPath $devScript -Raw
    Assert-True ($devSource -match '(?m)^&[^\n]*"link-hidden-packages\.ps1"') 'the development startup links the hidden packages'
    $sessionStartSource = Get-Content -LiteralPath $sessionStart -Raw
    Assert-True ($sessionStartSource -match '(?m)^\s*pwsh[^\n]*link-hidden-packages\.ps1') 'the remote session start links the hidden packages'
    Assert-True ($sessionStartSource -match 'HIDDEN_PACKAGES_TOKEN') 'the remote session start clones the private repository with its token'
    Assert-True ($sessionStartSource -match 'corro-hidden-packages') 'the remote session start knows the private repository'
}
finally {
    Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Hidden package links: all tests passed.'
