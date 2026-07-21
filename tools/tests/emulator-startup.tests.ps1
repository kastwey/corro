$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\EmulatorStartup.psm1') -Force
Import-Module (Join-Path $PSScriptRoot '..\DockerStartup.psm1') -Force

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

# Docker startup is selected by host type without coupling the emulator planner to a specific OS.
$target = Get-DockerStartupTarget -Platform Windows -DesktopPath 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
Assert-Equal 'WindowsDesktop' $target.Kind 'Windows starts Docker Desktop'

$target = Get-DockerStartupTarget -Platform macOS -DesktopPath '/Applications/Docker.app'
Assert-Equal 'MacDesktop' $target.Kind 'macOS starts Docker Desktop'

$target = Get-DockerStartupTarget -Platform Linux -DockerContext 'default' `
    -SystemServiceInstalled $true -UserServiceInstalled $true
Assert-Equal 'LinuxSystemService' $target.Kind 'a default Linux context prefers docker.service'
Assert-Equal 'docker.service' $target.Value 'the system Docker unit is selected'

$target = Get-DockerStartupTarget -Platform Linux -DockerContext 'desktop-linux' `
    -SystemServiceInstalled $true -DesktopServiceInstalled $true
Assert-Equal 'LinuxUserService' $target.Kind 'the Docker Desktop context keeps its user service'
Assert-Equal 'docker-desktop.service' $target.Value 'the Docker Desktop unit is selected'

$target = Get-DockerStartupTarget -Platform Linux -DockerContext 'rootless' `
    -SystemServiceInstalled $true -UserServiceInstalled $true
Assert-Equal 'LinuxUserService' $target.Kind 'a rootless context keeps its user service'
Assert-Equal 'docker.service' $target.Value 'the rootless Docker unit is selected'

$target = Get-DockerStartupTarget -Platform Linux -LegacyServiceInstalled $true
Assert-Equal 'LinuxLegacyService' $target.Kind 'a non-systemd Docker service is supported'

$windowsInstallMissing = $false
try {
    Get-DockerStartupTarget -Platform Windows | Out-Null
}
catch {
    $windowsInstallMissing = $_.Exception.Message -like '*Docker Desktop*not found*'
}
Assert-Equal $true $windowsInstallMissing 'a missing Windows installation is explained clearly'

$linuxInstallMissing = $false
try {
    Get-DockerStartupTarget -Platform Linux | Out-Null
}
catch {
    $linuxInstallMissing = $_.Exception.Message -like '*no Docker service*found*'
}
Assert-Equal $true $linuxInstallMissing 'a missing Linux service is explained clearly'

Write-Host 'Emulator and Docker startup planners: all tests passed.'
