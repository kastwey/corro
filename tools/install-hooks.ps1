# install-hooks.ps1 — point git at the repo's shared hooks (.githooks/), so `git push`
# runs the test suites and refuses to push when they are red. Run once per clone:
#
#   pwsh -File tools/install-hooks.ps1
#
# (Equivalent one-liner: git config core.hooksPath .githooks)
#
# core.hooksPath is per-clone git config, not something a checkout can set for you — hence
# this script. The hook itself (.githooks/pre-push) is versioned, so everyone shares the same
# gate. Undo with: git config --unset core.hooksPath

$ErrorActionPreference = 'Stop'
$root = (git rev-parse --show-toplevel).Trim()
Set-Location $root

git config core.hooksPath .githooks

# On a fresh clone the hook may lack its executable bit; git needs it on macOS/Linux.
# (No-op on Windows, where git runs hooks through sh regardless of the bit.)
try { git update-index --chmod=+x .githooks/pre-push 2>$null } catch { }

Write-Host "✔ core.hooksPath set to .githooks."
Write-Host "  git push now runs the frontend + backend suites and blocks a red push."
Write-Host "  Include E2E in a push with:  `$env:RUN_E2E = '1'; git push"
