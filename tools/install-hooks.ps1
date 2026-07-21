# install-hooks.ps1 — point git at the repo's shared hooks (.githooks/), so `git push`
# runs the test suites and refuses to push when they are red. tools/dev.ps1 calls this
# automatically; run it directly once per clone when using another development path:
#
#   pwsh -File tools/install-hooks.ps1
#
# (Equivalent one-liner: git config core.hooksPath .githooks)
#
# core.hooksPath is per-clone git config, not something a checkout can set for you — hence
# this script. The hook itself (.githooks/pre-push) is versioned, so everyone shares the same
# gate. Undo with: git config --unset core.hooksPath

[CmdletBinding()]
param(
	# Explicit for callers and isolated tests; otherwise use the current Git working tree.
	[string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
if ($RepositoryRoot) {
	$root = (Resolve-Path -LiteralPath $RepositoryRoot).Path
}
else {
	$rootResult = & git rev-parse --show-toplevel 2>$null
	if ($LASTEXITCODE -ne 0) {
		throw 'The hook installer must run inside a Git working tree.'
	}
	$root = ($rootResult | Select-Object -Last 1).Trim()
}

$hook = Join-Path $root '.githooks/pre-push'
if (-not (Test-Path -LiteralPath $hook -PathType Leaf)) {
	throw "The shared pre-push hook was not found at '$hook'."
}

& git -C $root config --local --replace-all core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
	throw 'Could not configure core.hooksPath for this clone.'
}

# Repair both the working-tree permission on macOS/Linux and the mode tracked by Git.
# Git for Windows runs hooks through sh regardless of the filesystem executable bit.
if (-not $IsWindows) {
	& chmod +x $hook
	if ($LASTEXITCODE -ne 0) {
		throw 'Could not make the shared pre-push hook executable.'
	}
}
& git -C $root update-index --chmod=+x -- .githooks/pre-push 2>$null
if ($LASTEXITCODE -ne 0) {
	throw 'Could not mark the shared pre-push hook as executable in the Git index.'
}

Write-Host "✔ Shared pre-push hook ready for this clone."
Write-Host "  Every push to any branch now runs the frontend + backend suites and blocks a red push."
Write-Host "  Include E2E in a push with:  `$env:RUN_E2E = '1'; git push"
