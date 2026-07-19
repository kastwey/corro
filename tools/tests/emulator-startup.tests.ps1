$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\EmulatorStartup.psm1') -Force

function Assert-Equal {
    param($Expected, $Actual, [string]$Because)
    if ($Expected -ne $Actual) {
        throw "Assertion failed ($Because). Expected '$Expected', got '$Actual'."
    }
}

# Regression: an emulator owned by another Compose project already publishes the expected
# endpoints. The startup plan must reuse both and invoke no new service (no port collision).
$plan = @(Get-EmulatorStartupPlan -CosmosPortOpen $true -CosmosReady $true -AzuritePortOpen $true -AzuriteReady $true)
Assert-Equal 0 $plan.Count 'healthy existing emulators are reused'

$plan = @(Get-EmulatorStartupPlan -CosmosPortOpen $true -CosmosReady $true -AzuritePortOpen $false -AzuriteReady $false)
Assert-Equal 1 $plan.Count 'only the missing service is started'
Assert-Equal 'azurite' $plan[0] 'Azurite is the missing service'

$plan = @(Get-EmulatorStartupPlan -CosmosPortOpen $false -CosmosReady $false -AzuritePortOpen $false -AzuriteReady $false)
Assert-Equal 2 $plan.Count 'both stopped services are started'
Assert-Equal 'cosmos' $plan[0] 'Cosmos starts first'
Assert-Equal 'azurite' $plan[1] 'Azurite starts second'

$cosmosConflict = $false
try {
    Get-EmulatorStartupPlan -CosmosPortOpen $true -CosmosReady $false -AzuritePortOpen $true -AzuriteReady $true | Out-Null
}
catch {
    $cosmosConflict = $_.Exception.Message -like '*8081*Cosmos*'
}
Assert-Equal $true $cosmosConflict 'a foreign listener on 8081 is rejected clearly'

$azuriteConflict = $false
try {
    Get-EmulatorStartupPlan -CosmosPortOpen $true -CosmosReady $true -AzuritePortOpen $true -AzuriteReady $false | Out-Null
}
catch {
    $azuriteConflict = $_.Exception.Message -like '*10000*Azurite*'
}
Assert-Equal $true $azuriteConflict 'a foreign listener on 10000 is rejected clearly'

Write-Host 'Emulator startup planner: all tests passed.'
