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

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$agentsPath = Join-Path $root 'AGENTS.md'
$claudePath = Join-Path $root 'CLAUDE.md'
$copilotPath = Join-Path $root '.github/copilot-instructions.md'

Assert-True (Test-Path -LiteralPath $agentsPath -PathType Leaf) 'AGENTS.md is the instruction source'
$claudeInstructions = @(Get-Content -LiteralPath $claudePath | Where-Object { $_.Trim() })
Assert-Equal 2 $claudeInstructions.Count 'Claude has only a heading and the shared import'
Assert-Equal '# Claude Code Instructions' $claudeInstructions[0] 'Claude instructions use an English heading'
Assert-Equal '@AGENTS.md' $claudeInstructions[1] 'Claude imports the shared instructions without duplicating them'
Assert-Equal $false (Test-Path -LiteralPath $copilotPath) `
    'Copilot uses AGENTS.md directly instead of a duplicate instruction file'

$agents = Get-Content -LiteralPath $agentsPath -Raw
Assert-True $agents.Contains('English-only repository (mandatory)') `
    'the shared instructions state the repository language rule'

# Keep authored instructions and executable scripts in English. Build the detector from
# fragments/code points so the regression test does not contain the words it rejects.
$accentCharacters = -join @(0x00E1, 0x00E9, 0x00ED, 0x00F3, 0x00FA, 0x00F1, 0x00FC, 0x00BF, 0x00A1 | ForEach-Object { [char]$_ })
$nonEnglishWords = @(
    ('pa' + 'ra'), ('cua' + 'ndo'), ('des' + 'de'), ('has' + 'ta'), ('enton' + 'ces'),
    ('nin' + 'guno'), ('nin' + 'guna'), ('to' + 'dos'), ('to' + 'das'),
    ('par' + 'tida'), ('par' + 'tidas'), ('jue' + 'go'), ('jue' + 'gos'),
    ('juga' + 'dor'), ('juga' + 'dores'), ('ta' + 'blero'), ('ta' + 'bleros'),
    ('car' + 'peta'), ('car' + 'petas'), ('ar' + 'chivo'), ('ar' + 'chivos'),
    ('eje' + 'cuta'), ('ins' + 'tala'), ('ini' + 'cia'), ('de' + 'tiene'),
    ('prue' + 'ba'), ('prue' + 'bas'), ('cam' + 'bios'), ('ser' + 'vidor'),
    ('gu' + [char]0x00ED + 'a'), ('espa' + [char]0x00F1 + 'ol')
)
$accentPattern = '[' + [Regex]::Escape($accentCharacters) + ']'
$wordPattern = '(?i)(?<![A-Za-z0-9_])(?:' + (($nonEnglishWords | ForEach-Object { [Regex]::Escape($_) }) -join '|') + ')(?![A-Za-z0-9_])'
$languagePattern = [Regex]::new("$accentPattern|$wordPattern")

$scriptFiles = @(& git -C $root ls-files -- '*.ps1' '*.psm1' '*.sh' '*.cmd' '*.bat' '*.js' '*.mjs' '*.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate tracked scripts.' }
$filesToCheck = @($scriptFiles + 'AGENTS.md' + 'CLAUDE.md' + 'tools/tests/repository-language.tests.ps1' | Sort-Object -Unique)
$violations = New-Object System.Collections.Generic.List[string]

foreach ($relativePath in $filesToCheck) {
    $path = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $lines = Get-Content -LiteralPath $path
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($languagePattern.IsMatch($lines[$index])) {
            $violations.Add("${relativePath}:$($index + 1): $($lines[$index].Trim())")
        }
    }
}

if ($violations.Count -gt 0) {
    throw "Non-English authored text found outside translation resources:`n$($violations -join "`n")"
}

Write-Host 'Repository language and shared agent instructions: all tests passed.'