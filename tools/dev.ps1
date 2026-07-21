# One-shot local dev stack: brings the emulators up in Docker (Cosmos + Azurite) via docker compose,
# then runs the server ON THE HOST in the foreground — so you can Ctrl+C it or attach a debugger.
#
#   pwsh tools/dev.ps1            # emulators + complete frontend watch + foreground server
#   pwsh tools/dev.ps1 -NoWatch   # one frontend build, but no continuing watcher
#   pwsh tools/dev.ps1 -Build     # also mirror the initial build into server/wwwroot
#
# Development serves frontend/dist directly. The watcher updates JS, HTML, CSS, i18n, config and
# assets there; refresh the browser to see changes. It stops with the server. The emulators keep
# running after Ctrl+C; stop Corro-owned ones with: pwsh tools/stop.ps1
# Docker is started automatically when installed but stopped (Desktop on Windows/macOS,
# docker.service or a user service on Linux). Missing/unsupported installations fail early.
# pwsh is cross-platform, so this works on Windows, macOS and Linux.
param([switch]$Build, [switch]$NoWatch)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $root "server/CorroServer.csproj"
$cosmosConn = "AccountEndpoint=http://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=="

# 1. Reuse healthy emulators already published on the standard ports (even if another Compose
#    project owns them); start only what is missing. The helper still waits for Cosmos health, so
#    the server's one-time initialization never races the emulator's slow first start.
& (Join-Path $PSScriptRoot "start-emulators.ps1")

# 2. Connection-string secrets for the HOST server (idempotent). It reaches the emulators on localhost
#    because the compose ports are published to the host.
dotnet user-secrets --project $proj set "ConnectionStrings:PackageBlobs" "UseDevelopmentStorage=true" | Out-Null
dotnet user-secrets --project $proj set "ConnectionStrings:CosmosDB" $cosmosConn | Out-Null
Write-Host "Secrets set (PackageBlobs + CosmosDB)."

# 3. Build frontend/dist before the server chooses its Development file provider. This also makes a
#    fresh clone safe: the server can never start before index.html exists. The optional -Build mirror
#    remains useful when inspecting the packaged wwwroot, although Development itself serves dist.
$frontend = Join-Path $root "frontend"
$frontendDependencies = @("typescript", "chokidar")
$missingFrontendDependency = $frontendDependencies | Where-Object {
    -not (Test-Path (Join-Path $frontend "node_modules/$_"))
} | Select-Object -First 1
if ($missingFrontendDependency) {
    Write-Host "Installing frontend dependencies ..."
    Push-Location $frontend
    try { & npm install; if ($LASTEXITCODE -ne 0) { throw "npm install failed." } }
    finally { Pop-Location }
}
Write-Host "Building frontend -> frontend/dist ..."
Push-Location $frontend
try { & npm run build; if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." } }
finally { Pop-Location }

if ($Build) {
    Write-Host "Mirroring initial frontend build -> server/wwwroot ..."
    $dist = Join-Path $frontend "dist"; $wwwroot = Join-Path $root "server/wwwroot"
    if (Test-Path $wwwroot) { Remove-Item -Recurse -Force $wwwroot }
    Copy-Item -Recurse $dist $wwwroot
}

$frontendWatcher = $null
if (-not $NoWatch) {
    $node = (Get-Command node -ErrorAction Stop).Source
    $frontendWatcher = Start-Process -FilePath $node -ArgumentList @("watch.js", "--skip-initial-build") `
        -WorkingDirectory $frontend -NoNewWindow -PassThru
    Write-Host "Frontend watch started (PID $($frontendWatcher.Id)); refresh the browser after edits."
}

# 4. Server (foreground; Ctrl+C stops it, emulators keep running).
Get-Process -Name CorroServer -ErrorAction SilentlyContinue | Stop-Process -Force
$env:ASPNETCORE_ENVIRONMENT = "Development"
# Bind the whole LAN (phones/tablets join via http://<pc-ip>:5000). An env var instead of --urls: the
# flag would override launchSettings AND the var; the var also applies if the exe is launched directly.
# --no-launch-profile makes it the single source of truth (the profile would re-add the https endpoint).
$env:ASPNETCORE_URLS = "http://0.0.0.0:5000"
Write-Host "Emulators stay up after Ctrl+C. tools/stop.ps1 stops only Corro-owned containers; reused external emulators are left untouched."
# LAN IP is a nicety for phones/tablets; Get-NetIPAddress is Windows-only, so guard it.
$lanIp = $null
if ($IsWindows) {
    $lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -in 'Dhcp','Manual' } |
        Select-Object -First 1).IPAddress
}
Write-Host "Starting server on http://localhost:5000$(if ($lanIp) { " (LAN: http://${lanIp}:5000)" }) ..."
try {
    & dotnet run --project $proj -p:SkipFrontendBuild=true --no-launch-profile
}
finally {
    if ($frontendWatcher -and -not $frontendWatcher.HasExited) {
        Stop-Process -Id $frontendWatcher.Id -Force -ErrorAction SilentlyContinue
        Write-Host "Frontend watch stopped."
    }
}
