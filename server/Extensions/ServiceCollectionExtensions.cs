using System.Text.Json;
using System.Text.Json.Serialization;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using CorroServer.Services.Rules;
using CorroServer.Services.Sounds;
using Microsoft.Azure.Cosmos;

namespace CorroServer.Extensions;

public static class ServiceCollectionExtensions
{
	public static IServiceCollection AddCorroServices(this IServiceCollection services, IConfiguration configuration)
	{
		// Persistence: CosmosDB when a connection string is configured (production / local emulator),
		// otherwise an in-memory store so a clone-and-run or offline dev session can create/join/play
		// with zero Azure setup (games just don't survive a restart). Mirrors the blob store's local
		// fallback below.
		var cosmosConnectionString = configuration.GetConnectionString("CosmosDB");
		var useCosmos = !string.IsNullOrWhiteSpace(cosmosConnectionString);

		// Configure Cosmos DB with System.Text.Json.
		if (useCosmos)
		{
			services.AddSingleton<CosmosClient>(serviceProvider =>
			{
				var connectionString = configuration.GetConnectionString("CosmosDB")!;

				var cosmosClientOptions = new CosmosClientOptions
				{
					// Use the app's System.Text.Json serializer instead of the Cosmos default.
					Serializer = new SystemTextJsonCosmosSerializer(new JsonSerializerOptions
					{
						PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
						WriteIndented = false,
						DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
						// Match the frontend's enum values (red_star, blue_disc, etc.).
						Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) }
					})
				};

				// Local Cosmos emulator: gateway-only, and (on some builds) a self-signed cert, so the
				// client must use Gateway mode and accept that cert. Gated to the emulator so it NEVER
				// relaxes TLS against a real account. (Endpoint/key detected from the connection string.)
				if (IsCosmosEmulator(connectionString))
				{
					cosmosClientOptions.ConnectionMode = ConnectionMode.Gateway;
					cosmosClientOptions.LimitToEndpoint = true;
					cosmosClientOptions.HttpClientFactory = () => new HttpClient(new HttpClientHandler
					{
						ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
					});
				}

				return new CosmosClient(connectionString, cosmosClientOptions);
			});
		}

		// Register Rulebooks (central game logic)
		services.AddSingleton<IRandomSource, SystemRandomSource>();
		services.AddSingleton<ICorroRulebook, CorroRulebook>();
		services.AddSingleton<IAuctionRulebook, AuctionRulebook>();

		// Register application services
		// The composite serves the bundled default pack PLUS each package game's own sounds. The
		// package store registers/unregisters those packs over the game lifecycle (same instance).
		services.AddSingleton<DefaultSoundPackProvider>();
		services.AddSingleton<CompositeSoundPackProvider>(sp =>
			new CompositeSoundPackProvider(sp.GetRequiredService<DefaultSoundPackProvider>()));
		services.AddSingleton<ISoundPackProvider>(sp => sp.GetRequiredService<CompositeSoundPackProvider>());
		services.AddSingleton<CorroPackageStore>(sp =>
			new CorroPackageStore(sp.GetRequiredService<CompositeSoundPackProvider>()));
		// Approved boards shipped with the server (server/Packages/, copied to the build output).
		services.AddSingleton<ShippedPackageProvider>(_ => new ShippedPackageProvider());
		services.AddSingleton<IPackageValidator, PackageValidator>();
		// Durable storage for uploaded package archives (so package games survive a restart): Azure
		// Blob in production (when a "PackageBlobs" connection string is configured), otherwise the
		// local filesystem impl for dev + tests.
		services.AddSingleton<IPackageBlobStore>(_ =>
		{
			var connectionString = configuration.GetConnectionString("PackageBlobs");
			return string.IsNullOrWhiteSpace(connectionString)
				? new LocalFilePackageBlobStore()
				: new AzureBlobPackageStore(connectionString);
		});
		// Re-stages a package (shipped or uploaded) when a package game is restored.
		services.AddSingleton<PackageRestorer>();
		services.AddSingleton<IAuctionTimerService, AuctionTimerService>();
		services.AddSingleton<INopeWindowService, NopeWindowService>();
		// The process-wide live-session registry (in-memory games, connection maps, persisters). A
		// single injected singleton replacing GameHub's former static state.
		services.AddSingleton<CorroServer.Hubs.GameSessionRegistry>();
		// Bot seats live OUTSIDE the engine (Services/Bots): the driver observes state changes
		// and plays through the same command pipeline as a human. E2E overrides BotOptions
		// with a near-zero action delay (last registration wins).
		services.AddSingleton(new CorroServer.Services.Bots.BotOptions());
		services.AddSingleton(sp => new CorroServer.Services.Bots.BotDriver(
			sp.GetRequiredService<CorroServer.Services.Bots.BotOptions>(),
			sp.GetRequiredService<ILogger<CorroServer.Services.Bots.BotDriver>>()));
		// Singleton (stateless): its dependencies are all singletons and Create() returns a fresh game
		// service, so it holds no per-request state. This lets the singleton live-session registry
		// (also a singleton) inject it without a captive-dependency lifetime mismatch.
		services.AddSingleton<IGameServiceFactory, GameServiceFactory>();
		if (useCosmos)
		{
			// Singleton (stateless: wraps the singleton CosmosClient). Injectable by the singleton
			// registry, and avoids a per-request client lookup.
			services.AddSingleton<IGameRepository, CosmosGameRepository>();
		}
		else
		{
			// Singleton so games persist across requests for the life of the process.
			services.AddSingleton<IGameRepository, InMemoryGameRepository>();
		}
		// IGameService is not scoped: each game owns an instance created by IGameServiceFactory.
		// GameStateHelper owns board state; the former BoardService is no longer needed.

		// ASP.NET Core transport services.
		services.AddControllers();
		services.AddSignalR()
			.AddJsonProtocol(options =>
			{
				options.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
				options.PayloadSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
				// Match the frontend's enum values (red_star, blue_disc, etc.).
				options.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower));
			});

		return services;
	}

	// The Cosmos DB emulator's fixed, well-known master key. It is identical on every emulator and is
	// published in Microsoft's docs — it is NOT a secret, and a real account never uses it. Matching it
	// lets us recognise the emulator even when the endpoint host isn't "localhost" (e.g. the "cosmos"
	// service name inside a Docker Compose network).
	internal const string CosmosEmulatorAccountKey =
		"C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

	/// <summary>
	/// True when the connection string points at the local Cosmos DB emulator (not a real account):
	/// a localhost/127.0.0.1 endpoint, OR the emulator's well-known key (so it also matches from inside
	/// a container network where the host is a service name). Used to relax the client to Gateway mode.
	/// </summary>
	internal static bool IsCosmosEmulator(string connectionString) =>
		connectionString.Contains("localhost", StringComparison.OrdinalIgnoreCase)
		|| connectionString.Contains("127.0.0.1")
		|| connectionString.Contains(CosmosEmulatorAccountKey, StringComparison.Ordinal);

	public static async Task InitializeCosmosDbAsync(this IServiceProvider serviceProvider)
	{
		var logger = serviceProvider.GetRequiredService<ILogger<CosmosClient>>();
		var cosmosClient = serviceProvider.GetService<CosmosClient>();
		if (cosmosClient is null)
		{
			logger.LogInformation("No CosmosDB connection string configured — using the in-memory game store (games are not durable across restarts).");
			return;
		}

		try
		{
			logger.LogInformation("Initializing Cosmos DB database and containers...");

			// Create database without throughput (for serverless accounts)
			var databaseResponse = await cosmosClient.CreateDatabaseIfNotExistsAsync(
				id: "CorroGame"
			// No throughput for serverless accounts
			);

			var database = databaseResponse.Database;
			logger.LogInformation("CorroGame database: {Status}",
				databaseResponse.StatusCode == System.Net.HttpStatusCode.Created ? "Created" : "Already exists");

			// Create Games container (unified for lobbies and games)
			var gamesContainerResponse = await database.CreateContainerIfNotExistsAsync(
				id: "Games",
				partitionKeyPath: "/gameId"
			// No throughput - automatically assigned for serverless accounts
			);

			logger.LogInformation("Games container: {Status}",
				gamesContainerResponse.StatusCode == System.Net.HttpStatusCode.Created ? "Created" : "Already exists");

			logger.LogInformation("Cosmos DB initialization completed successfully");
		}
		catch (Exception ex)
		{
			logger.LogError(ex, "Error initializing Cosmos DB");
			throw;
		}
	}
}
