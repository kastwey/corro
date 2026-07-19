# Stops the local dev emulators (Cosmos + Azurite) brought up by tools/dev.ps1 / docker compose.
# Safe to run anytime. The Azurite volume is kept (uploaded packages survive); pass -Wipe to drop it.
#
#   pwsh tools/stop.ps1          # stop and remove the emulator containers
#   pwsh tools/stop.ps1 -Wipe    # also delete the Azurite data volume
param([switch]$Wipe)
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
if ($Wipe) { docker compose down -v } else { docker compose down }
Pop-Location
Write-Host "Corro-owned emulators stopped$(if ($Wipe) { ' (Azurite volume wiped)' } else { ' (Azurite volume kept)' }); reused containers from other Compose projects were left untouched."
