# Deployment gate: the private packages must be validated before they are published.
#
# The private boards are excluded from Git, so the frontend, server and e2e jobs run on a
# checkout where they do not exist. KeyIntegrityTests — the Theory written to cover them, which
# iterates whatever is on disk — therefore only ever saw the committed packages, and the restored
# bundle travelled straight from an opaque zip into the publish artifact. A board the current
# engine would reject reached players with nothing anywhere saying so.
#
# The deploy job now validates every package between the restore and the publish. That ORDER is
# the whole guarantee, and it is invisible in a diff: a step moved a few lines up, or a `dotnet
# publish` that quietly runs first, restores the silent failure without looking wrong. So it is
# asserted here rather than trusted.
#
# The template also enables blob versioning, which is what makes the single overwritten bundle
# recoverable. Losing that line loses the only copy of the private packages outside the
# maintainer's machine, so it is pinned too.

$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Actual, [string]$Because)
    if (-not $Actual) { throw "Assertion failed: $Because." }
}

function Assert-Ordered {
    param([int]$First, [int]$Second, [string]$Because)
    Assert-True ($First -ge 0) "$Because (the earlier step is missing)"
    Assert-True ($Second -ge 0) "$Because (the later step is missing)"
    Assert-True ($First -lt $Second) $Because
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$workflow = Get-Content -LiteralPath (Join-Path $root '.github/workflows/ci.yml') -Raw
$bicep = Get-Content -LiteralPath (Join-Path $root 'infra/github-deploy.bicep') -Raw
$readme = Get-Content -LiteralPath (Join-Path $root 'infra/README.md') -Raw

# ── The gate exists, and sits between the restore and the publish ──────────────
$restore = $workflow.IndexOf('- name: Restore private packages', [StringComparison]::Ordinal)
$validate = $workflow.IndexOf('- name: Validate every package before publishing', [StringComparison]::Ordinal)
$publish = $workflow.IndexOf('- name: Publish application', [StringComparison]::Ordinal)

Assert-Ordered $restore $validate 'packages are validated only after the private bundle is restored'
Assert-Ordered $validate $publish 'packages are validated before the application is published'

# The gate is worthless if it cannot fail the job, and `dotnet test` inside a `run:` block only
# stops the step while the shell is strict about it.
$gate = $workflow.Substring($validate, $publish - $validate)
Assert-True ($gate -match 'set -euo pipefail') 'the validation step fails the job on a failing command'
Assert-True ($gate -match 'corro-package\.dll validate|\$cli" validate|\$cli validate') `
    'the validation step runs the package validator over the packages on disk'
Assert-True ($gate -match 'KeyIntegrityTests') 'the validation step runs the dangling-key tests'

# A bundle that unzipped to nothing passes `unzip -t`. Publishing then silently drops every
# private board from production, which is the failure this guard exists to make loud.
Assert-True ($gate -match 'git ls-files server/Packages') `
    'the validation step counts the committed packages as its floor'
Assert-True ($gate -match 'refusing to publish') `
    'the validation step refuses to publish when the bundle restored no private package'

# ── The tooling tests are only a gate if CI actually runs them ─────────────────
Assert-True ($workflow -match 'deployment-gate\.tests\.ps1') `
    'CI runs this test with the other development-tooling tests'

# ── The bundle stays recoverable ───────────────────────────────────────────────
Assert-True ($bicep -match 'isVersioningEnabled:\s*true') `
    'the storage account keeps a version of every published bundle'
Assert-True ($bicep -match 'deleteRetentionPolicy:') `
    'a deleted bundle stays recoverable for a while'
Assert-True ($readme -match 'Recovering a private package bundle') `
    'the README explains how to restore a previous bundle'

Write-Host 'Deployment gate: all tests passed.'
