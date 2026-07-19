namespace CorroServer.Tests;

/// <summary>
/// A <see cref="FactAttribute"/> that runs only when the Azure Cosmos DB emulator is reachable on
/// 127.0.0.1:8081, and SKIPS (not fails) otherwise — so the Cosmos integration tests run locally
/// (start the emulator) but never break CI, which has none. Start it with <c>docker compose up -d cosmos</c>
/// (the vnext-preview emulator serves the NoSQL API over HTTP on :8081).
/// </summary>
public sealed class CosmosFactAttribute : FactAttribute
{
	public CosmosFactAttribute()
	{
		if (!Emulators.CosmosReachable())
		{
			Skip = "Cosmos emulator is not running on 127.0.0.1:8081 — start it (docker compose up -d cosmos) to run these tests.";
		}
	}
}

/// <summary>
/// A <see cref="FactAttribute"/> for tests that need BOTH emulators (Azurite + Cosmos) — e.g. the full
/// create→persist→restore flow. Skips (never fails) unless both are reachable. Start them with <c>tools/dev.ps1</c>.
/// </summary>
public sealed class EmulatorsFactAttribute : FactAttribute
{
	public EmulatorsFactAttribute()
	{
		if (!Emulators.Reachable(Emulators.AzuriteBlobPort) || !Emulators.CosmosReachable())
		{
			Skip = "Both the Azurite (:10000) and Cosmos (:8081) emulators must be running — start them with tools/dev.ps1.";
		}
	}
}
