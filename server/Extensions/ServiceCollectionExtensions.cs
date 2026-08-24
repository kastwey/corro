using System.Text.Json;
using System.Text.Json.Serialization;
using CorroServer.Services;
using CorroServer.Services.Accounts;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using CorroServer.Services.Rules;
using CorroServer.Services.Sounds;
using CorroServer.Services.Voice;
using Microsoft.Azure.Cosmos;

namespace CorroServer.Extensions;

public static class ServiceCollectionExtensions
{
	public static IServiceCollection AddCorroServices(this IServiceCollection services, IConfiguration configuration)
	{
		// Who answers for the personal data this deployment holds. Empty is valid so a fresh clone
		// and local development can start, but it means "no built-in notice", not "no personal
		// data": account-less tables still hold names, credentials, game records and chat. What is
		// NOT valid is half of the identity — a name with no way to reach it is worse than silence,
		// because it looks like an answer.
		services.AddOptions<PrivacyOptions>()
			.Bind(configuration.GetSection(PrivacyOptions.SectionName))
			.Validate(options =>
				options.IsConfigured
				|| (string.IsNullOrWhiteSpace(options.ControllerName)
					&& string.IsNullOrWhiteSpace(options.Jurisdiction)
					&& string.IsNullOrWhiteSpace(options.Contact)),
				$"{PrivacyOptions.SectionName} must be either completely empty or have ControllerName, "
				+ "Jurisdiction and Contact all set — a partial notice names nobody reachable.")
			.Validate(options =>
				(options.ControllerName?.Length ?? 0) <= PrivacyOptions.MaxNameLength
				&& (options.Jurisdiction?.Length ?? 0) <= PrivacyOptions.MaxJurisdictionLength
				&& (options.Contact?.Length ?? 0) <= PrivacyOptions.MaxContactLength,
				$"{PrivacyOptions.SectionName} values exceed their maximum lengths.")
			.ValidateOnStart();

		// One boolean, nothing to validate: absent or false, the deployment simply says nothing.
		services.AddOptions<PublicMetricsOptions>()
			.Bind(configuration.GetSection(PublicMetricsOptions.SectionName));

		// Which build this is. Deliberately NOT validated on start: a version is a courtesy to the
		// reader, and a malformed stamp is a reason to say nothing rather than a reason to refuse
		// to serve a game (BuildInfoOptions.IsConfigured decides that, per field).
		services.AddOptions<BuildInfoOptions>()
			.Bind(configuration.GetSection(BuildInfoOptions.SectionName));

		services.AddOptions<SiteBrandingOptions>()
			.Bind(configuration.GetSection(SiteBrandingOptions.SectionName))
			.Validate(options =>
				!string.IsNullOrWhiteSpace(options.Title)
				&& options.Title == options.Title.Trim()
				&& options.Title.Length <= SiteBrandingOptions.MaxTitleLength,
				$"{SiteBrandingOptions.SectionName}:Title must contain between 1 and {SiteBrandingOptions.MaxTitleLength} characters.")
			.Validate(options => options.Tagline is null
				|| (options.Tagline == options.Tagline.Trim()
					&& options.Tagline.Length <= SiteBrandingOptions.MaxTaglineLength),
				$"{SiteBrandingOptions.SectionName}:Tagline must not exceed {SiteBrandingOptions.MaxTaglineLength} characters.")
			.Validate(options => options.Taglines.All(pair =>
				!string.IsNullOrWhiteSpace(pair.Key)
				&& pair.Key == pair.Key.Trim()
				&& pair.Key.Length <= 35
				&& !string.IsNullOrWhiteSpace(pair.Value)
				&& pair.Value == pair.Value.Trim()
				&& pair.Value.Length <= SiteBrandingOptions.MaxTaglineLength),
				$"{SiteBrandingOptions.SectionName}:Taglines must use non-empty locale keys and values no longer than {SiteBrandingOptions.MaxTaglineLength} characters.")
			.Validate(options => SiteBrandingOptions.IsSupportedAssetUrl(options.LogoUrl),
				$"{SiteBrandingOptions.SectionName}:LogoUrl must be a relative path or an HTTPS URL.")
			.Validate(options => SiteBrandingOptions.IsSupportedAssetUrl(options.LogoDarkUrl),
				$"{SiteBrandingOptions.SectionName}:LogoDarkUrl must be a relative path or an HTTPS URL.")
			.Validate(options => SiteBrandingOptions.IsSupportedAssetUrl(options.FaviconUrl),
				$"{SiteBrandingOptions.SectionName}:FaviconUrl must be a relative path or an HTTPS URL.")
			.Validate(options => SiteBrandingOptions.IsSupportedAssetUrl(options.FaviconDarkUrl),
				$"{SiteBrandingOptions.SectionName}:FaviconDarkUrl must be a relative path or an HTTPS URL.")
			.ValidateOnStart();

		services.AddOptions<GameRetentionOptions>()
			.Bind(configuration.GetSection(GameRetentionOptions.SectionName))
			.Validate(options => options.InactivityDays > 0, "GameRetention:InactivityDays must be greater than zero.")
			.Validate(options => options.RunAtUtcHour is >= 0 and <= 23, "GameRetention:RunAtUtcHour must be between 0 and 23.")
			.Validate(options => options.MaxGamesPerRun > 0, "GameRetention:MaxGamesPerRun must be greater than zero.")
			.ValidateOnStart();

		// Voice is an optional deployment capability. An entirely empty section keeps it off;
		// a partially configured section fails startup instead of exposing a broken host control.
		services.AddOptions<LiveKitOptions>()
			.Bind(configuration.GetSection(LiveKitOptions.SectionName))
			.Validate(options => options.IsEmpty || options.IsConfigured,
				"LiveKit must provide a secure browser URL, API key and API secret; ApiUrl is optional.")
			.Validate(options => options.TokenLifetimeMinutes is >= 1 and <= 60,
				"LiveKit:TokenLifetimeMinutes must be between 1 and 60.")
			.ValidateOnStart();

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
		services.AddSingleton<IRoundClockService, RoundClockService>();
		services.AddSingleton<ILiveKitVoiceService, LiveKitVoiceService>();
		// The process-wide live-session registry (in-memory games, connection maps, persisters). A
		// single injected singleton replacing GameHub's former static state.
		services.AddSingleton<CorroServer.Hubs.GameSessionRegistry>();
		// Who is here, by account. Separate from the registry above on purpose: that one knows
		// about seats, this one about people (see PresenceRegistry).
		services.AddSingleton<CorroServer.Hubs.PresenceRegistry>();
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
			// Accounts follow the games' durability: with Cosmos they survive restarts, without it
			// they are process-local like everything else in a clone-and-run session.
			services.AddSingleton<IUserRepository, CosmosUserRepository>();
			// Retention is relevant only to durable production-style persistence. It catches up once on
			// startup and then runs daily, reusing the same session-aware deletion path as the Hub.
			services.AddSingleton<GameRetentionCleanup>();
			services.AddHostedService<GameRetentionWorker>();
		}
		else
		{
			// Singleton so games persist across requests for the life of the process.
			services.AddSingleton<IGameRepository, InMemoryGameRepository>();
			services.AddSingleton<IUserRepository, InMemoryUserRepository>();
		}

		// Optional external sign-in. With no provider configured this registers the schemes and an
		// empty catalog, so the client shows no account UI and everything account-less is unaffected.
		services.AddCorroAuthentication(configuration);
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

	/// <summary>
	/// Every container this build reads, with the key it is partitioned by.
	///
	/// Declared once, as data, because the two things that must agree about it live far apart: the
	/// repositories that OPEN these containers, and the startup that CREATES them. When they were
	/// separate lists of code they drifted, and the drift was invisible — a missing container is not
	/// an error until somebody tries to write to one, which in production meant a whole feature that
	/// simply never worked. <c>CosmosContainerProvisioningTests</c> now holds them together.
	///
	/// Each is partitioned by the key it is actually QUERIED with, so its lookup is a point read and
	/// the container's own duplicate-id rejection can serve as the concurrency guard: Users by
	/// account, Identities by the (issuer, subject) composite sign-in arrives with, Handles by the
	/// name whose uniqueness they decide, and Friendships by the PAIR, since a friendship is one
	/// fact about two people.
	/// </summary>
	public static readonly IReadOnlyList<(string Name, string PartitionKeyPath)> CosmosContainers =
	[
		(CosmosGameRepository.GamesContainerName, "/gameId"),
		(CosmosUserRepository.UsersContainerName, "/userId"),
		(CosmosUserRepository.IdentitiesContainerName, "/identityKey"),
		(CosmosUserRepository.HandlesContainerName, "/handle"),
		(CosmosUserRepository.FriendshipsContainerName, "/pairId"),
	];

	/// <summary>
	/// Ensures the database and every container above. Idempotent, and cheap enough to run on every
	/// startup in every environment — which it must, because nothing else provisions them.
	/// </summary>
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
			logger.LogInformation("Ensuring the Cosmos DB database and its {Count} containers...", CosmosContainers.Count);

			// No throughput anywhere below: the account is serverless, which assigns it itself.
			var databaseResponse = await cosmosClient.CreateDatabaseIfNotExistsAsync(
				id: CosmosUserRepository.DatabaseName);
			var database = databaseResponse.Database;
			logger.LogInformation("{Database} database: {Status}",
				CosmosUserRepository.DatabaseName,
				databaseResponse.StatusCode == System.Net.HttpStatusCode.Created ? "Created" : "Already exists");

			foreach (var (name, partitionKeyPath) in CosmosContainers)
			{
				var response = await database.CreateContainerIfNotExistsAsync(name, partitionKeyPath);
				// "Created" in production is worth noticing: it means this container had been
				// missing, and whatever reads it had been failing until now.
				logger.LogInformation("{Container} container: {Status}", name,
					response.StatusCode == System.Net.HttpStatusCode.Created ? "Created" : "Already exists");
			}

			logger.LogInformation("Cosmos DB initialization completed successfully");
		}
		catch (Exception ex)
		{
			logger.LogError(ex, "Error initializing Cosmos DB");
			throw;
		}
	}
}
