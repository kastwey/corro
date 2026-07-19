<#
.SYNOPSIS
    Zips a .corro package folder (manifest.json + board.json + cards.json [+ sounds/])
    into a single uploadable <name>.corro file.

.EXAMPLE
    ./tools/pack-corro.ps1 packages/imperio-galactico
    # -> imperio-galactico.corro  (upload it in the lobby's "upload a board" field)

.EXAMPLE
    ./tools/pack-corro.ps1 server.tests/Fixtures/corro-classic -Out corro-classic.corro
#>
param(
    [Parameter(Mandatory)][string]$Dir,
    [string]$Out
)

if (-not (Test-Path (Join-Path $Dir 'manifest.json'))) {
    throw "No manifest.json in '$Dir' — point at a package folder."
}

$leaf = Split-Path $Dir -Leaf
if (-not $Out) { $Out = "$leaf.corro" }

# Compress-Archive only writes .zip, so build the zip then rename to .corro.
$tmp = [System.IO.Path]::ChangeExtension($Out, '.zip')
if (Test-Path $tmp) { Remove-Item $tmp -Force }
if (Test-Path $Out) { Remove-Item $Out -Force }

Compress-Archive -Path (Join-Path $Dir '*') -DestinationPath $tmp -Force
Move-Item $tmp $Out -Force
Write-Host "Created $Out"
