Set-StrictMode -Version Latest

function Test-LocalTcpPort {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][int]$Port,
        [int]$TimeoutMilliseconds = 500
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connect = $client.ConnectAsync('127.0.0.1', $Port)
        return $connect.Wait($TimeoutMilliseconds) -and $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Test-CosmosEmulatorEndpoint {
    [CmdletBinding()]
    param([string]$Uri = 'http://127.0.0.1:8081/')

    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(3)
    try {
        $response = $client.GetAsync($Uri).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) { return $false }
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $account = $body | ConvertFrom-Json -ErrorAction Stop
        return $account.id -eq 'cosmosdev' -or $account._rid -eq 'cosmosdev'
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Test-AzuriteBlobEndpoint {
    [CmdletBinding()]
    param([string]$Uri = 'http://127.0.0.1:10000/devstoreaccount1?comp=list')

    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(3)
    try {
        # An anonymous list request is expected to return 403. The server product header is
        # the fingerprint: any other process on :10000 must not be mistaken for Azurite.
        $response = $client.GetAsync($Uri).GetAwaiter().GetResult()
        return $response.Headers.Server.ToString().StartsWith('Azurite-Blob/', [StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Get-EmulatorStartupPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][bool]$CosmosPortOpen,
        [Parameter(Mandatory)][bool]$CosmosReady,
        [Parameter(Mandatory)][bool]$AzuritePortOpen,
        [Parameter(Mandatory)][bool]$AzuriteReady
    )

    $services = [System.Collections.Generic.List[string]]::new()
    if (-not $CosmosReady) {
        if ($CosmosPortOpen) {
            throw 'Port 8081 is occupied, but the service does not identify itself as the Cosmos DB emulator.'
        }
        $services.Add('cosmos')
    }
    if (-not $AzuriteReady) {
        if ($AzuritePortOpen) {
            throw 'Port 10000 is occupied, but the service does not identify itself as the Azurite Blob emulator.'
        }
        $services.Add('azurite')
    }
    return $services.ToArray()
}

function Start-CorroEmulators {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Root)

    $cosmosReady = Test-CosmosEmulatorEndpoint
    $azuriteReady = Test-AzuriteBlobEndpoint
    $cosmosPortOpen = $cosmosReady -or (Test-LocalTcpPort -Port 8081)
    $azuritePortOpen = $azuriteReady -or (Test-LocalTcpPort -Port 10000)
    $services = @(Get-EmulatorStartupPlan `
        -CosmosPortOpen $cosmosPortOpen -CosmosReady $cosmosReady `
        -AzuritePortOpen $azuritePortOpen -AzuriteReady $azuriteReady)

    if ($cosmosReady) { Write-Host 'Cosmos emulator already responds on http://localhost:8081; reusing it.' }
    if ($azuriteReady) { Write-Host 'Azurite already responds on http://localhost:10000; reusing it.' }
    if ($services.Count -eq 0) { return }

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "The missing emulator service(s) [$($services -join ', ')] require Docker, but 'docker' was not found on PATH."
    }

    Write-Host "Starting missing emulator service(s): $($services -join ', ') ..."
    Push-Location $Root
    try {
        & docker compose up -d --wait @services
        if ($LASTEXITCODE -ne 0) {
            # A service may have appeared between the probe and Compose (another dev stack won
            # the race). Accept it only when both real endpoint fingerprints now pass.
            if ((Test-CosmosEmulatorEndpoint) -and (Test-AzuriteBlobEndpoint)) { return }
            throw "docker compose could not start: $($services -join ', '). Is Docker running?"
        }

        # Docker can leave a container running but UNPUBLISHED after a previous bind failure
        # (HostConfig asks for 8081 while NetworkSettings has no effective binding). A normal
        # `compose up` then reports success without repairing it. Retry only such still-missing
        # services with recreation; the first normal attempt preserves data in stopped containers.
        $stillMissing = [System.Collections.Generic.List[string]]::new()
        if ($services -contains 'cosmos' -and -not (Test-CosmosEmulatorEndpoint)) { $stillMissing.Add('cosmos') }
        if ($services -contains 'azurite' -and -not (Test-AzuriteBlobEndpoint)) { $stillMissing.Add('azurite') }
        if ($stillMissing.Count -gt 0) {
            Write-Host "Repairing stale emulator container(s) without host bindings: $($stillMissing -join ', ') ..."
            & docker compose up -d --wait --force-recreate @stillMissing
            if ($LASTEXITCODE -ne 0) {
                throw "docker compose could not recreate stale emulator service(s): $($stillMissing -join ', ')."
            }
        }
    }
    finally {
        Pop-Location
    }

    # Compose's Cosmos healthcheck and Azurite's running state should make both probes
    # immediately true. Verify the actual HOST endpoints before configuring the app.
    if (-not (Test-CosmosEmulatorEndpoint)) {
        throw 'Cosmos did not become reachable at http://localhost:8081 after Docker Compose completed.'
    }
    if (-not (Test-AzuriteBlobEndpoint)) {
        throw 'Azurite did not become reachable at http://localhost:10000 after Docker Compose completed.'
    }
}

Export-ModuleMember -Function Test-LocalTcpPort, Test-CosmosEmulatorEndpoint, Test-AzuriteBlobEndpoint, Get-EmulatorStartupPlan, Start-CorroEmulators
