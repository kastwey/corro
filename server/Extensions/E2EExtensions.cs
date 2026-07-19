using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Extensions;

/// <summary>
/// Deterministic test mode for the Playwright end-to-end suite. Active ONLY when the server
/// runs with <c>ASPNETCORE_ENVIRONMENT=E2E</c> — neither the registrations nor the endpoints
/// exist in any other environment.
///
/// In this mode the whole game is scripted: dice and other random values come from a queue the
/// suite fills over <c>POST /e2e/random</c>, decks keep their cards.json order, the turn order
/// keeps the join order, and persistence is forced in-memory so runs are hermetic (no Cosmos,
/// even if the machine has a connection string configured). An unscripted roll fails loudly —
/// a test that forgot to script a value is broken, and must never get real randomness.
/// </summary>
public static class E2EExtensions
{
	/// <summary>Payload for <c>POST /e2e/random</c>: raw values consumed in order by the dice rolls.</summary>
	public sealed record E2ERandomScript(int[] Values);

	/// <summary>
	/// Overrides the production randomness/persistence with the deterministic E2E doubles.
	/// Call AFTER <see cref="ServiceCollectionExtensions.AddCorroServices"/> (last registration wins).
	/// </summary>
	public static IServiceCollection AddE2ETestMode(this IServiceCollection services, string? packagesRoot = null)
	{
		services.AddSingleton<ScriptedRandomSource>();
		services.AddSingleton<IRandomSource>(sp => sp.GetRequiredService<ScriptedRandomSource>());
		// Hermetic persistence: never touch Cosmos from an E2E run.
		services.AddSingleton<IGameRepository, InMemoryGameRepository>();
		// Bots act almost instantly: the humanizing pause would only slow the suite down.
		services.AddSingleton(new CorroServer.Services.Bots.BotOptions
		{
			ActionDelay = TimeSpan.FromMilliseconds(50),
		});
		// Merge E2E-only shipped packages from outside server/Packages. They exercise listing,
		// unlock, staging, persistence and play without entering production publish artifacts.
		if (!string.IsNullOrWhiteSpace(packagesRoot))
		{
			services.AddSingleton<ShippedPackageProvider>(_ => new ShippedPackageProvider(
				additionalPackagesDirs: new[] { packagesRoot }));
		}
		return services;
	}

	/// <summary>Maps the test-only control endpoints the Playwright suite drives the script with.</summary>
	public static WebApplication MapE2ETestEndpoints(this WebApplication app)
	{
		// Enqueue the next raw random values (e.g. [3,4] for a two-dice roll). Returns the pending count so a test
		// can assert its script was consumed.
		app.MapPost("/e2e/random", (E2ERandomScript script, ScriptedRandomSource rng) =>
		{
			rng.Enqueue(script.Values);
			return Results.Ok(new { pending = rng.PendingCount });
		});

		// Drop any unconsumed values (between tests, so one test's leftovers can't leak).
		app.MapPost("/e2e/reset", (ScriptedRandomSource rng) =>
		{
			rng.Reset();
			return Results.Ok(new { pending = rng.PendingCount });
		});

		return app;
	}
}
