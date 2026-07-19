<#
.SYNOPSIS
    Publishes the local, Git-ignored server/Packages folders to the private deployment blob.

.DESCRIPTION
    The public repository intentionally excludes packages that cannot be redistributed. GitHub
    Actions therefore cannot check them out. This script discovers those folders through
    git check-ignore, creates an archive outside the repository, and uploads it with the caller's
    Microsoft Entra identity. No storage key or package name is printed or stored in Git.

    Run this whenever a private package changes. The next successful main deployment restores the
    bundle before dotnet publish, so private packages travel inside the App Service artifact.
#>
[CmdletBinding()]
param(
    [string]$StorageAccount = 'imperio',
    [string]$Container = 'deployment',
    [string]$Blob = 'private-packages.zip'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$packagesRoot = Join-Path $repoRoot 'server/Packages'
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("corro-private-packages-" + [Guid]::NewGuid().ToString('N'))
$archivePath = "$stagingRoot.zip"

try {
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

    $privatePackages = @(Get-ChildItem $packagesRoot -Directory | Where-Object {
        & git -C $repoRoot check-ignore --quiet -- $_.FullName
        $LASTEXITCODE -eq 0
    })

    if ($privatePackages.Count -eq 0) {
        throw 'No Git-ignored package folders were found under server/Packages.'
    }

    foreach ($package in $privatePackages) {
        Copy-Item $package.FullName (Join-Path $stagingRoot $package.Name) -Recurse
    }

    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $stagingRoot,
        $archivePath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false)

    & az storage blob upload `
        --account-name $StorageAccount `
        --container-name $Container `
        --name $Blob `
        --file $archivePath `
        --auth-mode login `
        --overwrite true `
        --only-show-errors `
        --output none
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI upload failed with exit code $LASTEXITCODE."
    }

    $hash = (Get-FileHash $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = [math]::Round((Get-Item $archivePath).Length / 1MB, 2)
    Write-Host "Published $($privatePackages.Count) private package folders ($size MB, SHA-256 $hash)."
}
finally {
    Remove-Item $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $archivePath -Force -ErrorAction SilentlyContinue
}
