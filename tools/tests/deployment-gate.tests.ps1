# Deployment gate: the hidden packages are tested with every change and validated before they
# are published.
#
# The hidden boards live in a private repository. Every test job checks them out first, so an
# engine change is tested against them like against the committed ones; the deploy job checks
# them out again, then validates every package on disk between that restore and the publish. That
# ORDER is the whole guarantee, and it is invisible in a diff: a step moved a few lines up, or a
# `dotnet publish` that quietly runs first, restores the silent failure without looking wrong. So
# it is asserted here rather than trusted.
#
# The same file pins the two things that make the round trip work: a push to the private
# repository can ask for a deployment (repository_dispatch), and a clone without the token still
# runs — a fork gets the engine without the hidden packages, not a red pipeline.

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
$action = Get-Content -LiteralPath (Join-Path $root '.github/actions/hidden-packages/action.yml') -Raw
$readme = Get-Content -LiteralPath (Join-Path $root 'docs/deployment.md') -Raw

# ── Every test layer sees the hidden packages ──────────────────────────────────
foreach ($job in 'frontend', 'server', 'e2e') {
    $start = $workflow.IndexOf("`n  ${job}:", [StringComparison]::Ordinal)
    Assert-True ($start -ge 0) "the $job job exists"
    $end = $workflow.IndexOf("`n  ", $start + 1, [StringComparison]::Ordinal)
    while ($end -ge 0 -and $workflow.Substring($end + 3, 1) -eq ' ') {
        $end = $workflow.IndexOf("`n  ", $end + 1, [StringComparison]::Ordinal)
    }
    $body = if ($end -ge 0) { $workflow.Substring($start, $end - $start) } else { $workflow.Substring($start) }
    $checkout = $body.IndexOf('uses: actions/checkout@', [StringComparison]::Ordinal)
    $hidden = $body.IndexOf('uses: ./.github/actions/hidden-packages', [StringComparison]::Ordinal)
    Assert-Ordered $checkout $hidden "the $job job checks the hidden packages out right after the repository"
    Assert-True ($body -match 'token:\s*\$\{\{\s*secrets\.HIDDEN_PACKAGES_TOKEN\s*\}\}') `
        "the $job job passes the private repository token to the hidden packages action"
}

# ── The gate exists, and sits between the restore and the publish ──────────────
$restore = $workflow.IndexOf('- name: Restore hidden packages', [StringComparison]::Ordinal)
$validate = $workflow.IndexOf('- name: Validate every package before publishing', [StringComparison]::Ordinal)
$publish = $workflow.IndexOf('- name: Publish application', [StringComparison]::Ordinal)

Assert-Ordered $restore $validate 'packages are validated only after the hidden packages are restored'
Assert-Ordered $validate $publish 'packages are validated before the application is published'

# Production ships the private repository's main, whatever branch the trigger came from.
$restoreStep = $workflow.Substring($restore, $validate - $restore)
Assert-True ($restoreStep -match 'ref:\s*main') 'the deployment restores the hidden packages from main'

# The gate is worthless if it cannot fail the job, and `dotnet test` inside a `run:` block only
# stops the step while the shell is strict about it.
$gate = $workflow.Substring($validate, $publish - $validate)
Assert-True ($gate -match 'set -euo pipefail') 'the validation step fails the job on a failing command'
Assert-True ($gate -match 'corro-package\.dll validate|\$cli" validate|\$cli validate') `
    'the validation step runs the package validator over the packages on disk'
Assert-True ($gate -match 'KeyIntegrityTests') 'the validation step runs the dangling-key tests'

# A restore that produced nothing would publish the engine without its hidden boards, which is
# the failure this guard exists to make loud.
Assert-True ($gate -match 'git ls-files server/Packages') `
    'the validation step counts the committed packages as its floor'
Assert-True ($gate -match 'refusing to publish') `
    'the validation step refuses to publish when no hidden package was restored'
Assert-True ($workflow -match 'HIDDEN_PACKAGES_TOKEN is not configured') `
    'the deployment refuses to run without the private repository token'

# ── A package change reaches production ────────────────────────────────────────
Assert-True ($workflow -match '(?m)^\s*repository_dispatch:\s*\r?\n\s*types:\s*\[hidden-packages-updated\]') `
    'the private repository can ask for a deployment'
Assert-True ($workflow -match "github\.event_name == 'repository_dispatch'") `
    'a deployment asked for by the private repository actually deploys'

# ── A clone without the token still runs ───────────────────────────────────────
Assert-True ($action -match 'required:\s*false') 'the token is optional for the hidden packages action'
Assert-True ($action -match 'if \[\[ -z "\$TOKEN" \]\]') 'the action skips itself without a token'
Assert-True ($action -match 'count=0') 'a skipped action reports zero packages'
# Branch to branch: a pull request is tested with the private branch of the same name.
Assert-True ($action -match 'github\.head_ref \|\| github\.ref_name') 'the action prefers the private branch named like the current one'
Assert-True ($action -match 'ref=main') 'the action falls back to main when no such branch exists'

# ── The tooling tests are only a gate if CI actually runs them ─────────────────
Assert-True ($workflow -match 'deployment-gate\.tests\.ps1') `
    'CI runs this test with the other development-tooling tests'
Assert-True ($workflow -match 'hidden-packages-link\.tests\.ps1') `
    'CI runs the hidden package link tests with the other development-tooling tests'

# ── The setup is written down ──────────────────────────────────────────────────
Assert-True ($readme -match 'HIDDEN_PACKAGES_TOKEN') 'the deployment docs name the secret the pipeline needs'
Assert-True ($readme -match 'CORRO_DISPATCH_TOKEN') 'the deployment docs name the secret the private repository needs'

Write-Host 'Deployment gate: all tests passed.'
