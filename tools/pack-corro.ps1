<#
.SYNOPSIS
    Validates and packs a package folder into one uploadable .corro file by calling
    the Corro Package SDK. Kept as a compatibility wrapper for existing workflows.

.EXAMPLE
    ./tools/pack-corro.ps1 packages/galactic-empire
    # -> galactic-empire.corro  (upload it in the lobby's "upload a board" field)

.EXAMPLE
    ./tools/pack-corro.ps1 server.tests/Fixtures/corro-classic -Out corro-classic.corro
#>
param(
    [Parameter(Mandatory)][string]$Dir,
    [string]$Out
)

$project = Join-Path $PSScriptRoot 'Corro.PackageCli/Corro.PackageCli.csproj'
$arguments = @('run', '--project', $project, '-p:SkipFrontendBuild=true', '--', 'pack', $Dir)
if ($Out) {
    $arguments += @('--output', $Out)
}

& dotnet @arguments
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
