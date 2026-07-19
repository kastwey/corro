namespace CorroServer.Tests;

/// <summary>
/// A <see cref="FactAttribute"/> that runs only when the Azurite blob emulator is reachable on
/// 127.0.0.1:10000, and SKIPS (not fails) otherwise — so the Azure blob integration tests run
/// locally (start Azurite) but never break CI, which has no emulator. Start it with
/// <c>docker compose up -d azurite</c> (the compose service passes --skipApiVersionCheck, needed
/// because the SDK sends a newer API version than Azurite supports).
/// </summary>
public sealed class AzuriteFactAttribute : FactAttribute
{
	public AzuriteFactAttribute()
	{
		if (!Emulators.Reachable(Emulators.AzuriteBlobPort))
		{
			Skip = "Azurite is not running on 127.0.0.1:10000 — start it (docker compose up -d azurite) to run the blob integration tests.";
		}
	}
}
