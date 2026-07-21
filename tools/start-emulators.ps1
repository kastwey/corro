# Starts only the local emulator services that are missing. Healthy Cosmos/Azurite instances
# already published on the standard host ports are reused even when another Compose project owns
# them; a foreign process on either port fails with a precise diagnostic. When Docker is installed
# but stopped, this starts Docker Desktop or the appropriate Linux service before invoking Compose.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'EmulatorStartup.psm1') -Force
Start-CorroEmulators -Root $root
