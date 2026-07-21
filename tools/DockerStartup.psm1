Set-StrictMode -Version Latest

function Get-CurrentDockerPlatform {
    if ($IsWindows) { return 'Windows' }
    if ($IsMacOS) { return 'macOS' }
    if ($IsLinux) { return 'Linux' }
    throw 'Automatic Docker startup is supported only on Windows, macOS, and Linux.'
}

function Invoke-QuietNativeCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @()
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = -1
    $lines = @()
    try {
        # PowerShell 7 can promote a native non-zero exit to a terminating error. Probes need
        # the exit code and diagnostic instead, and must not leak Docker's daemon error to users.
        $ErrorActionPreference = 'Continue'
        $lines = @(& $FilePath @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    catch {
        $lines = @($_.Exception.Message)
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    [pscustomobject]@{
        ExitCode = $exitCode
        Output = (($lines | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
    }
}

function Get-DockerDesktopPath {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidateSet('Windows', 'macOS')][string]$Platform)

    if ($Platform -eq 'macOS') {
        foreach ($candidate in @('/Applications/Docker.app', (Join-Path $HOME 'Applications/Docker.app'))) {
            if (Test-Path -LiteralPath $candidate) { return $candidate }
        }
        return $null
    }

    $candidates = [System.Collections.Generic.List[string]]::new()
    $desktopCommand = Get-Command 'Docker Desktop.exe' -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($desktopCommand) { $candidates.Add($desktopCommand.Source) }

    foreach ($basePath in @(${env:ProgramW6432}, ${env:ProgramFiles}, ${env:LOCALAPPDATA})) {
        if ([string]::IsNullOrWhiteSpace($basePath)) { continue }
        $candidates.Add((Join-Path $basePath 'Docker/Docker/Docker Desktop.exe'))
        $candidates.Add((Join-Path $basePath 'Docker/Docker Desktop.exe'))
    }

    # App Paths also covers a non-default Docker Desktop installation directory.
    foreach ($registryPath in @(
        'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Docker Desktop.exe',
        'Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Docker Desktop.exe'
    )) {
        try {
            if (Test-Path -LiteralPath $registryPath) {
                $registeredPath = (Get-Item -LiteralPath $registryPath).GetValue('')
                if (-not [string]::IsNullOrWhiteSpace($registeredPath)) {
                    $candidates.Add($registeredPath)
                }
            }
        }
        catch {
            # A restricted registry key should not hide the standard installation probes.
        }
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return $null
}

function Resolve-DockerCommand {
    [CmdletBinding()]
    param()

    $command = Get-Command docker -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($command) { return $command.Source }

    $platform = Get-CurrentDockerPlatform
    $candidates = switch ($platform) {
        'Windows' {
            $desktopPath = Get-DockerDesktopPath -Platform Windows
            if ($desktopPath) {
                Join-Path (Split-Path -Parent $desktopPath) 'resources/bin/docker.exe'
            }
            foreach ($basePath in @(${env:ProgramW6432}, ${env:ProgramFiles}, ${env:LOCALAPPDATA})) {
                if (-not [string]::IsNullOrWhiteSpace($basePath)) {
                    Join-Path $basePath 'Docker/Docker/resources/bin/docker.exe'
                }
            }
        }
        'macOS' {
            $desktopPath = Get-DockerDesktopPath -Platform macOS
            if ($desktopPath) { Join-Path $desktopPath 'Contents/Resources/bin/docker' }
            '/Applications/Docker.app/Contents/Resources/bin/docker'
            Join-Path $HOME 'Applications/Docker.app/Contents/Resources/bin/docker'
            '/usr/local/bin/docker'
        }
        'Linux' {
            '/usr/bin/docker'
            '/usr/local/bin/docker'
            '/snap/bin/docker'
        }
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }

    $message = switch ($platform) {
        'Windows' { 'Docker Desktop is not installed, or its CLI could not be found. Install Docker Desktop from https://docs.docker.com/desktop/setup/install/windows-install/.' }
        'macOS' { 'Docker Desktop is not installed, or its CLI could not be found. Install Docker Desktop from https://docs.docker.com/desktop/setup/install/mac-install/.' }
        'Linux' { 'The Docker CLI was not found. Install Docker Engine and its CLI from https://docs.docker.com/engine/install/.' }
    }
    throw "$message Docker is required to start the missing Cosmos DB/Azurite emulators."
}

function Get-DockerEngineProbe {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$DockerCommand)

    $result = Invoke-QuietNativeCommand -FilePath $DockerCommand -Arguments @('info', '--format', '{{.ServerVersion}}')
    [pscustomobject]@{
        Ready = $result.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($result.Output)
        Detail = $result.Output
    }
}

function Test-DockerEngineReady {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$DockerCommand)

    return (Get-DockerEngineProbe -DockerCommand $DockerCommand).Ready
}

function Test-DockerComposeAvailable {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$DockerCommand)

    return (Invoke-QuietNativeCommand -FilePath $DockerCommand -Arguments @('compose', 'version')).ExitCode -eq 0
}

function Get-DockerContext {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$DockerCommand)

    $result = Invoke-QuietNativeCommand -FilePath $DockerCommand -Arguments @('context', 'show')
    if ($result.ExitCode -eq 0) { return $result.Output.Trim() }
    return ''
}

function Test-SystemdUnitInstalled {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Unit,
        [ValidateSet('system', 'user')][string]$Scope = 'system'
    )

    $systemctl = Get-Command systemctl -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $systemctl) { return $false }

    $arguments = @()
    if ($Scope -eq 'user') { $arguments += '--user' }
    $arguments += @('list-unit-files', $Unit, '--no-legend')
    $result = Invoke-QuietNativeCommand -FilePath $systemctl.Source -Arguments $arguments
    return $result.ExitCode -eq 0 -and $result.Output -match "(?m)^$([regex]::Escape($Unit))\s+"
}

function Get-DockerStartupTarget {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('Windows', 'macOS', 'Linux')][string]$Platform,
        [AllowEmptyString()][string]$DesktopPath = '',
        [AllowEmptyString()][string]$DockerContext = '',
        [bool]$SystemServiceInstalled = $false,
        [bool]$UserServiceInstalled = $false,
        [bool]$DesktopServiceInstalled = $false,
        [bool]$LegacyServiceInstalled = $false
    )

    if ($Platform -eq 'Windows') {
        if ([string]::IsNullOrWhiteSpace($DesktopPath)) {
            throw 'The Docker CLI is installed, but Docker Desktop was not found. Reinstall Docker Desktop or start a compatible Docker engine manually.'
        }
        return [pscustomobject]@{ Kind = 'WindowsDesktop'; Label = 'Docker Desktop'; Value = $DesktopPath }
    }

    if ($Platform -eq 'macOS') {
        if ([string]::IsNullOrWhiteSpace($DesktopPath)) {
            throw 'The Docker CLI is installed, but Docker Desktop.app was not found. Reinstall Docker Desktop or start a compatible Docker engine manually.'
        }
        return [pscustomobject]@{ Kind = 'MacDesktop'; Label = 'Docker Desktop'; Value = $DesktopPath }
    }

    # Respect the active Desktop/rootless context before falling back to the system daemon.
    if ($DockerContext -eq 'desktop-linux' -and $DesktopServiceInstalled) {
        return [pscustomobject]@{ Kind = 'LinuxUserService'; Label = 'Docker Desktop'; Value = 'docker-desktop.service' }
    }
    if ($DockerContext -match 'rootless' -and $UserServiceInstalled) {
        return [pscustomobject]@{ Kind = 'LinuxUserService'; Label = 'rootless Docker service'; Value = 'docker.service' }
    }
    if ($SystemServiceInstalled) {
        return [pscustomobject]@{ Kind = 'LinuxSystemService'; Label = 'Docker service'; Value = 'docker.service' }
    }
    if ($DesktopServiceInstalled) {
        return [pscustomobject]@{ Kind = 'LinuxUserService'; Label = 'Docker Desktop'; Value = 'docker-desktop.service' }
    }
    if ($UserServiceInstalled) {
        return [pscustomobject]@{ Kind = 'LinuxUserService'; Label = 'rootless Docker service'; Value = 'docker.service' }
    }
    if ($LegacyServiceInstalled) {
        return [pscustomobject]@{ Kind = 'LinuxLegacyService'; Label = 'Docker service'; Value = 'docker' }
    }

    throw 'The Docker CLI is installed, but no Docker service or Docker Desktop installation was found. Install Docker Engine from https://docs.docker.com/engine/install/ or start a compatible daemon manually.'
}

function Get-CurrentDockerStartupTarget {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$DockerCommand)

    $platform = Get-CurrentDockerPlatform
    if ($platform -eq 'Windows' -or $platform -eq 'macOS') {
        return Get-DockerStartupTarget -Platform $platform -DesktopPath (Get-DockerDesktopPath -Platform $platform)
    }

    $context = Get-DockerContext -DockerCommand $DockerCommand
    $systemServiceInstalled = Test-SystemdUnitInstalled -Unit 'docker.service' -Scope system
    $userServiceInstalled = Test-SystemdUnitInstalled -Unit 'docker.service' -Scope user
    $desktopServiceInstalled = Test-SystemdUnitInstalled -Unit 'docker-desktop.service' -Scope user
    $legacyServiceInstalled = (Test-Path -LiteralPath '/etc/init.d/docker' -PathType Leaf)
    return Get-DockerStartupTarget -Platform Linux -DockerContext $context `
        -SystemServiceInstalled $systemServiceInstalled -UserServiceInstalled $userServiceInstalled `
        -DesktopServiceInstalled $desktopServiceInstalled -LegacyServiceInstalled $legacyServiceInstalled
}

function Invoke-LinuxSystemServiceStart {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ServiceName)

    $systemctl = Get-Command systemctl -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $systemctl) { throw "systemctl is required to start $ServiceName, but it was not found." }

    $result = Invoke-QuietNativeCommand -FilePath $systemctl.Source -Arguments @('start', $ServiceName)
    if ($result.ExitCode -eq 0) { return }

    $sudo = Get-Command sudo -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $sudo) {
        throw "Could not start $ServiceName automatically. Run it with administrator privileges, then rerun the Corro startup command."
    }

    Write-Host "Starting $ServiceName requires administrator privileges; sudo may request your password."
    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = -1
    try {
        $ErrorActionPreference = 'Continue'
        & $sudo.Source $systemctl.Source start $ServiceName
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) {
        throw "Could not start $ServiceName automatically. Run 'sudo systemctl start $ServiceName', then rerun the Corro startup command."
    }
}

function Invoke-LinuxLegacyServiceStart {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ServiceName)

    $service = Get-Command service -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    $filePath = if ($service) { $service.Source } else { '/etc/init.d/docker' }
    $arguments = if ($service) { @($ServiceName, 'start') } else { @('start') }
    $result = Invoke-QuietNativeCommand -FilePath $filePath -Arguments $arguments
    if ($result.ExitCode -eq 0) { return }

    $sudo = Get-Command sudo -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $sudo) {
        throw "Could not start the $ServiceName service automatically. Start it with administrator privileges, then rerun the Corro startup command."
    }

    Write-Host "Starting the $ServiceName service requires administrator privileges; sudo may request your password."
    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = -1
    try {
        $ErrorActionPreference = 'Continue'
        & $sudo.Source $filePath @arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) {
        throw "Could not start the $ServiceName service automatically. Start it manually, then rerun the Corro startup command."
    }
}

function Start-DockerTarget {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Target,
        [Parameter(Mandatory)][string]$DockerCommand
    )

    switch ($Target.Kind) {
        'WindowsDesktop' {
            # New Docker Desktop versions expose a CLI that can also resume a stopped backend.
            $result = Invoke-QuietNativeCommand -FilePath $DockerCommand -Arguments @('desktop', 'start')
            if ($result.ExitCode -ne 0) {
                try { Start-Process -FilePath $Target.Value | Out-Null }
                catch { throw "Docker Desktop is installed but could not be launched: $($_.Exception.Message)" }
            }
        }
        'MacDesktop' {
            $result = Invoke-QuietNativeCommand -FilePath $DockerCommand -Arguments @('desktop', 'start')
            if ($result.ExitCode -ne 0) {
                $open = Get-Command open -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
                if (-not $open) { throw 'Docker Desktop is installed but the macOS open command was not found.' }
                $result = Invoke-QuietNativeCommand -FilePath $open.Source -Arguments @($Target.Value)
                if ($result.ExitCode -ne 0) { throw 'Docker Desktop is installed but could not be launched.' }
            }
        }
        'LinuxSystemService' {
            Invoke-LinuxSystemServiceStart -ServiceName $Target.Value
        }
        'LinuxUserService' {
            $systemctl = Get-Command systemctl -CommandType Application -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if (-not $systemctl) { throw "systemctl is required to start $($Target.Value), but it was not found." }
            $result = Invoke-QuietNativeCommand -FilePath $systemctl.Source -Arguments @('--user', 'start', $Target.Value)
            if ($result.ExitCode -ne 0) {
                throw "The installed $($Target.Label) could not be started. Start $($Target.Value) manually, then rerun the Corro startup command."
            }
        }
        'LinuxLegacyService' {
            Invoke-LinuxLegacyServiceStart -ServiceName $Target.Value
        }
        default {
            throw "Unsupported Docker startup target '$($Target.Kind)'."
        }
    }
}

function Wait-DockerEngineReady {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$DockerCommand,
        [ValidateRange(1, 600)][int]$TimeoutSeconds = 120
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if (Test-DockerEngineReady -DockerCommand $DockerCommand) { return $true }
        [System.Threading.Thread]::Sleep(1000)
    } while ([DateTime]::UtcNow -lt $deadline)

    return Test-DockerEngineReady -DockerCommand $DockerCommand
}

function Get-DockerConnectionFailureMessage {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Platform,
        [AllowEmptyString()][string]$Detail = '',
        [int]$TimeoutSeconds = 120,
        $Target
    )

    if ($Detail -match '(?i)permission denied|access is denied') {
        if ($Platform -eq 'Linux') {
            return "Docker is running, but the current user cannot access its socket. Add the user to the 'docker' group (or configure rootless Docker), sign in again, and rerun the Corro startup command."
        }
        return 'Docker is running, but the current user does not have permission to access its engine.'
    }

    if ($Target -and ($Target.Kind -match 'Desktop' -or $Target.Label -eq 'Docker Desktop')) {
        return "Docker Desktop was launched, but its engine did not become ready within $TimeoutSeconds seconds. Open Docker Desktop to resolve any startup prompt, then rerun the Corro startup command."
    }
    return "The installed Docker service was started, but its engine did not become ready within $TimeoutSeconds seconds. Check the service status, then rerun the Corro startup command."
}

function Initialize-DockerEngine {
    [CmdletBinding()]
    param([ValidateRange(1, 600)][int]$TimeoutSeconds = 120)

    $dockerCommand = Resolve-DockerCommand
    if (-not (Test-DockerComposeAvailable -DockerCommand $dockerCommand)) {
        throw "Docker was found at '$dockerCommand', but the Compose plugin is missing. Install Docker Compose from https://docs.docker.com/compose/install/."
    }

    $platform = Get-CurrentDockerPlatform
    $probe = Get-DockerEngineProbe -DockerCommand $dockerCommand
    if ($probe.Ready) { return $dockerCommand }
    if ($probe.Detail -match '(?i)permission denied|access is denied') {
        throw (Get-DockerConnectionFailureMessage -Platform $platform -Detail $probe.Detail)
    }

    $target = Get-CurrentDockerStartupTarget -DockerCommand $dockerCommand
    Write-Host "$($target.Label) is installed but not running; starting it ..."
    Start-DockerTarget -Target $target -DockerCommand $dockerCommand
    Write-Host "Waiting up to $TimeoutSeconds seconds for the Docker engine ..."
    if (-not (Wait-DockerEngineReady -DockerCommand $dockerCommand -TimeoutSeconds $TimeoutSeconds)) {
        $probe = Get-DockerEngineProbe -DockerCommand $dockerCommand
        throw (Get-DockerConnectionFailureMessage -Platform $platform -Detail $probe.Detail `
            -TimeoutSeconds $TimeoutSeconds -Target $target)
    }

    Write-Host 'Docker engine is ready.'
    return $dockerCommand
}

Export-ModuleMember -Function Resolve-DockerCommand, Test-DockerEngineReady, Get-DockerStartupTarget, Initialize-DockerEngine
