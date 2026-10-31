# link-hidden-packages.ps1 — make the hidden packages appear under server/Packages/.
#
# The packages that ship hidden on the maintainer's server live in their own private repository
# (kastwey/corro-hidden-packages), not in this one, so that a clone of the engine never carries
# content it cannot redistribute. This links each package folder of a clone of that repository
# into server/Packages/, where the engine, the tests and the package validator find it exactly
# like a committed one. Edits happen in place and are committed FROM the private clone.
#
#   pwsh tools/link-hidden-packages.ps1                      # ../corro-hidden-packages, or $env:CORRO_HIDDEN_PACKAGES
#   pwsh tools/link-hidden-packages.ps1 -Source <clone>      # an explicit clone
#
# tools/dev.ps1 calls it on every start, and so does the remote session-start hook after cloning
# the private repository. A missing clone is not an error: the engine works without these
# packages, it merely ships without them — which is what a clone without access gets.
#
# Junctions on Windows (no privilege needed), symbolic links elsewhere. /server/Packages/* is
# gitignored, so the links never show up in the engine's status; a real folder of the same name is
# left alone rather than replaced, because it may hold work not yet in the private clone.

[CmdletBinding()]
param(
	# The clone of the private repository. Defaults to $env:CORRO_HIDDEN_PACKAGES, then to a
	# sibling folder of the repository root named corro-hidden-packages.
	[string]$Source,
	# Explicit for isolated tests; otherwise the repository this script lives in.
	[string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'

if (-not $RepositoryRoot) { $RepositoryRoot = Split-Path -Parent $PSScriptRoot }
$root = (Resolve-Path -LiteralPath $RepositoryRoot).Path
if (-not $Source) { $Source = $env:CORRO_HIDDEN_PACKAGES }
if (-not $Source) { $Source = Join-Path (Split-Path -Parent $root) 'corro-hidden-packages' }

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
	Write-Host "Hidden packages: no clone at '$Source'; the engine runs with the committed packages only."
	exit 0
}
$Source = (Resolve-Path -LiteralPath $Source).Path

$packagesRoot = Join-Path $root 'server/Packages'
New-Item -ItemType Directory -Path $packagesRoot -Force | Out-Null

$linked = 0
$kept = 0
foreach ($package in Get-ChildItem -LiteralPath $Source -Directory | Sort-Object Name) {
	if (-not (Test-Path -LiteralPath (Join-Path $package.FullName 'manifest.json') -PathType Leaf)) { continue }

	$target = Join-Path $packagesRoot $package.Name
	if (Test-Path -LiteralPath $target) {
		$existing = Get-Item -LiteralPath $target -Force
		if ($existing.LinkType) {
			# Already a link. Repoint it if it aims elsewhere (a moved clone), otherwise nothing to do.
			$currentTarget = ($existing.Target | Select-Object -First 1)
			if ($currentTarget -and ((Resolve-Path -LiteralPath $currentTarget).Path -eq $package.FullName)) {
				$linked++
				continue
			}
			$existing.Delete()
		}
		else {
			Write-Warning "Hidden packages: '$target' is a real folder, not a link; left untouched. Move its contents into '$($package.FullName)' and delete it to link it."
			$kept++
			continue
		}
	}

	$linkType = if ($IsWindows) { 'Junction' } else { 'SymbolicLink' }
	New-Item -ItemType $linkType -Path $target -Target $package.FullName | Out-Null
	$linked++
}

Write-Host "Hidden packages: $linked linked from '$Source'$(if ($kept) { ", $kept real folder(s) kept" })."
