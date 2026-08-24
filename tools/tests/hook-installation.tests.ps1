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
$installer = Join-Path $tools 'install-hooks.ps1'
$devScript = Join-Path $tools 'dev.ps1'
$sessionStart = Join-Path $root '.claude/hooks/session-start.sh'
$readme = Join-Path $root 'README.md'
$tempRepo = Join-Path ([IO.Path]::GetTempPath()) ('corro-hook-test-' + [Guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Path (Join-Path $tempRepo '.githooks') -Force | Out-Null
    & git init --quiet $tempRepo
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the temporary Git repository.' }

    $hook = Join-Path $tempRepo '.githooks/pre-push'
    $hookSource = "#!/bin/sh`nprintf 'invoked' > hook-ran.txt`n"
    [IO.File]::WriteAllText($hook, $hookSource, [Text.UTF8Encoding]::new($false))
    & git -C $tempRepo add -- .githooks/pre-push
    if ($LASTEXITCODE -ne 0) { throw 'Could not stage the temporary hook.' }

    # A direct setup and a repeated setup must produce one stable per-clone value.
    & $installer -RepositoryRoot $tempRepo | Out-Null
    & $installer -RepositoryRoot $tempRepo | Out-Null
    $configuredPaths = @(& git -C $tempRepo config --local --get-all core.hooksPath)
    Assert-Equal 1 $configuredPaths.Count 'repeated installation stays idempotent'
    Assert-Equal '.githooks' $configuredPaths[0] 'the clone uses the versioned hook directory'

    # Verify Git resolves and executes the hook through the configured path.
    & git -C $tempRepo hook run pre-push -- origin test
    if ($LASTEXITCODE -ne 0) { throw 'Git did not execute the configured temporary hook.' }
    Assert-True (Test-Path (Join-Path $tempRepo 'hook-ran.txt')) 'the configured pre-push hook runs'

    # The normal startup must install the hook before any Docker/emulator work can fail.
    $devSource = Get-Content -LiteralPath $devScript -Raw
    $installPosition = $devSource.IndexOf('"install-hooks.ps1"', [StringComparison]::Ordinal)
    $emulatorPosition = $devSource.IndexOf('"start-emulators.ps1"', [StringComparison]::Ordinal)
    Assert-True ($installPosition -ge 0) 'the development startup installs hooks'
    Assert-True ($installPosition -lt $emulatorPosition) 'hook setup precedes emulator startup'

    # A REMOTE session is a fresh clone every time, and core.hooksPath is per-clone config, so
    # the net is absent there unless the session-start hook installs it too. It was: a push from
    # a cloud session ran no suites at all, silently, with nobody watching the terminal.
    # Anchored on the invocation itself (a line that RUNS pwsh), so that merely naming the script
    # in a comment can neither satisfy nor break these.
    $sessionStartSource = Get-Content -LiteralPath $sessionStart -Raw
    Assert-True ($sessionStartSource -match '(?m)^pwsh[^\n]*install-hooks\.ps1') 'the remote session start installs hooks'
    # Never fatal there: the hook is a local convenience (CI is the real gate), and aborting the
    # start-up over it would throw away the SDK, the packages and the browser the gates need.
    Assert-True ($sessionStartSource -match '(?m)^pwsh[^\n]*install-hooks\.ps1[^\n]*\\\r?\n\s*\|\|') 'a failed hook install does not abort the session start'

    $readmeSource = Get-Content -LiteralPath $readme -Raw
    Assert-True ($readmeSource.Contains('pwsh -File ./tools/install-hooks.ps1')) 'the README documents manual setup'
    Assert-True ($readmeSource.Contains('every push to any branch')) 'the README states the hook scope'
}
finally {
    Remove-Item -LiteralPath $tempRepo -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Shared hook installation: all tests passed.'