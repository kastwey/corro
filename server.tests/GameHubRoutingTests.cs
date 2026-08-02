using System.Text.Json;
using System.Text.Json.Serialization;
using System.Reflection;
using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Sounds;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;

namespace CorroServer.Tests;

/// <summary>
/// Integration-style regression tests for <see cref="GameHub.ExecuteCommand"/> response
/// routing. The "winner's auction modal never closes" bug was a Hub-level routing issue:
/// the response was only sent to <c>Clients.Caller</c>, so when the last opponent passed
/// (the winner sent no command) the winner never received <c>AUCTION_ENDED</c>. The fix
/// broadcasts <c>AUCTION_ENDED</c> to the whole game group while keeping every other
/// response private to the caller. These tests drive the real Hub with hand-rolled
/// SignalR fakes and verify exactly which client proxy receives <c>CommandResponse</c>.
/// </summary>
// Live state now lives in a per-test GameSessionRegistry (no shared static Hub state), so these
// tests are independent and need no serializing collection.
public class GameHubRoutingTests
{
	[Fact]
	public async Task ExecuteCommand_AuctionEnded_BroadcastsToGroup_NotOnlyCaller()
	{
		var (hub, clients, gameId, _) = BuildHub(
			new AuctionEndedResponse { SquareIndex = 1, SquareName = "Square 1", PropertySold = true, WinnerId = "a", WinningBid = 300 });

		await hub.ExecuteCommand(new PassAuctionCommand { PlayerId = "a", SquareIndex = 1 });

		// The whole group must hear it (so the non-acting winner's modal closes)...
		Assert.True(clients.Group(gameId).Received("CommandResponse"));
		// ...and it must NOT be sent only to the caller.
		Assert.False(clients.Caller.Received("CommandResponse"));
	}

	[Fact]
	public async Task ExecuteCommand_RegularResponse_GoesToCaller_NotGroup()
	{
		// A pass only changes the passer's own UI (their modal already closed locally); the
		// group learns through the announcements/state, so the response stays private.
		var (hub, clients, gameId, _) = BuildHub(
			new AuctionPassedResponse { SquareIndex = 1, PlayerId = "a", PlayerName = "A", RemainingBidders = 1 });

		await hub.ExecuteCommand(new PassAuctionCommand { PlayerId = "a", SquareIndex = 1 });

		// Private responses stay with the caller and must not flood the group.
		Assert.True(clients.Caller.Received("CommandResponse"));
		Assert.False(clients.Group(gameId).Received("CommandResponse"));
	}

	[Fact]
	public async Task ExecuteCommand_DiceRolled_BroadcastsToGroup_SoSpectatorsSeeTheDice()
	{
		// Live-play bug: "I only see dice when I roll" — DICE_ROLLED went only to the
		// roller, so spectators' visual dice trays never painted. The roll reaches the
		// whole group; the client handler is isMe-guarded for everything non-visual.
		var (hub, clients, gameId, _) = BuildHub(
			new DiceRolledResponse { PlayerId = "a", PlayerName = "A", Die1 = 3, Die2 = 4, Total = 7 });

		await hub.ExecuteCommand(new RollDiceCommand { PlayerId = "a" });

		Assert.True(clients.Group(gameId).Received("CommandResponse"));
		Assert.False(clients.Caller.Received("CommandResponse"));
	}

	[Fact]
	public async Task ExecuteCommand_BidPlaced_BroadcastsToGroup_SoRivalsSeeTheBidInstantly()
	{
		// Live-play bug: rivals only learned of a bid through the NEXT per-second timer tick,
		// so their "current bid" looked frozen. A bid is public information the moment it is
		// accepted — it reaches the whole group, firing every client's bidPlaced handler.
		var (hub, clients, gameId, _) = BuildHub(
			new BidPlacedResponse { SquareIndex = 1, SquareName = "Square 1", BidderId = "a", BidderName = "A", Amount = 50 });

		await hub.ExecuteCommand(new PlaceBidCommand { PlayerId = "a", SquareIndex = 1, Amount = 50 });

		Assert.True(clients.Group(gameId).Received("CommandResponse"));
		Assert.False(clients.Caller.Received("CommandResponse"));
	}

	[Fact]
	public async Task ExecuteCommand_PropertyDeclinedStartsAuction_BroadcastsAuctionStartedToGroup()
	{
		// Regression: in the buy-as-action turn model a property goes to auction when the
		// current player declines it by ending the turn (or re-rolling). The decline
		// response (PROPERTY_DECLINED) is private to the caller, so the auction must be
		// broadcast to the whole group separately — otherwise every OTHER player's auction
		// modal would never open and the timers would never start.
		var service = new FakeGameService(
			new PropertyDeclinedResponse { PlayerId = "a", SquareIndex = 1, SquareName = "Square 1", AuctionStarted = true })
		{
			GameStateOverride = new GameState
			{
				CurrentTurn = "a",
				ActiveAuction = new AuctionState { SquareIndex = 1, SquareName = "Square 1", InitiatorPlayerId = "a" }
			}
		};

		var (hub, clients, gameId) = BuildHub(service);

		await hub.ExecuteCommand(new EndTurnCommand { PlayerId = "a" });

		// The caller still gets the private PROPERTY_DECLINED response...
		Assert.True(clients.Caller.Received("CommandResponse"));
		// ...AND the auction start reaches the whole group so every modal opens.
		Assert.True(clients.Group(gameId).Received("CommandResponse"));
	}

	[Fact]
	public async Task ExecuteCommand_PropertyDeclinedWithoutAuction_DoesNotBroadcastToGroup()
	{
		// Declining without the auction smallBuilding rule (or with no auction started) must stay
		// private to the caller — no group broadcast.
		var service = new FakeGameService(
			new PropertyDeclinedResponse { PlayerId = "a", SquareIndex = 1, SquareName = "Square 1", AuctionStarted = false });

		var (hub, clients, gameId) = BuildHub(service);

		await hub.ExecuteCommand(new EndTurnCommand { PlayerId = "a" });

		Assert.True(clients.Caller.Received("CommandResponse"));
		Assert.False(clients.Group(gameId).Received("CommandResponse"));
	}

	[Fact]
	public async Task EndAuctionViaCommand_BroadcastsFullState_SoOwnershipRepaints()
	{
		// Regression: when an auction ends via the bid/max timer (no client command), the
		// won property was never marked as owned on any board because the timer path sent
		// only CommandResponse and persisted — it never broadcast the full GameStateChanged.
		// The fix calls NotifyStateChangedAsync so every client repaints ownership.
		var gameId = "g-" + Guid.NewGuid().ToString("N");
		var service = new FakeGameService(
			new AuctionEndedResponse { SquareIndex = 1, SquareName = "Square 1", PropertySold = true, WinnerId = "a", WinningBid = 12 })
		{
			// A LIVE auction, which is the only situation in which the bid timer legitimately
			// fires; a tick arriving after one already resolved is ignored (see the test below).
			GameStateOverride = new GameState
			{
				CurrentTurn = "a",
				ActiveAuction = new AuctionState { SquareIndex = 1, SquareName = "Square 1", InitiatorPlayerId = "a" },
			},
		};

		var hubContext = new FakeHubContext();
		var timer = new RaisableAuctionTimer();
		var registry = new GameSessionRegistry(hubContext, new FakeRepository(), timer, TestFixtures.NewPackageRestorer());
		registry.RegisterService(gameId, service);

		// Drive the real path: the bid timer firing → the registry ends the auction via command.
		await timer.RaiseBidTimeout(gameId);

		// The whole group must hear the auction result...
		Assert.True(hubContext.GroupProxy.Received("CommandResponse"));
		// ...AND the full state must be broadcast so ownership/money/turn repaint everywhere.
		Assert.True(service.NotifyStateChangedCalled);
	}

	/// <summary>
	/// Live-play report: a bid nobody could match ended the auction, and a moment later every
	/// player was shown the server insisting there was no active auction.
	///
	/// The bid timer runs on its own clock. When the auction resolves through the normal command
	/// path the timer is retired by the state change that follows, but a tick already in flight
	/// cannot be recalled — it issued EndAuctionCommand against nothing, and the NO_ACTIVE_AUCTION
	/// error was broadcast to the whole group as if the auction had failed.
	/// </summary>
	[Fact]
	public async Task BidTimeout_AfterTheAuctionAlreadyResolved_IsIgnoredInsteadOfErroringTheTable()
	{
		var gameId = "g-" + Guid.NewGuid().ToString("N");
		var service = new FakeGameService(
			new AuctionEndedResponse { SquareIndex = 1, SquareName = "Square 1", PropertySold = true, WinnerId = "a", WinningBid = 12 })
		{
			// The auction is over: the winning bid was accepted and the state already reflects it.
			GameStateOverride = new GameState { CurrentTurn = "a", ActiveAuction = null },
		};

		var hubContext = new FakeHubContext();
		var timer = new RaisableAuctionTimer();
		var registry = new GameSessionRegistry(hubContext, new FakeRepository(), timer, TestFixtures.NewPackageRestorer());
		registry.RegisterService(gameId, service);

		await timer.RaiseBidTimeout(gameId);

		Assert.Null(service.LastCommand);
		Assert.False(hubContext.GroupProxy.Received("CommandResponse"),
			"a resolved auction must not tell the table that anything went wrong");
	}

	[Fact]
	public async Task OnGameEvents_SendsPersonalizedBatch_ToEachPlayerConnection()
	{
		// Integration test for the "single stream" send path: SubscribeToGameEvents wires
		// GameService.OnGameEvents to the Hub, which must render EACH player's personalized,
		// ordered batch (actor → first-person _self lines; others → base lines; All → both)
		// and send it as one "GameEvents" message to that player's own connection(s).
		var gameId = "g-" + Guid.NewGuid().ToString("N");
		var connA = "c-" + Guid.NewGuid().ToString("N");
		var connB = "c-" + Guid.NewGuid().ToString("N");

		var service = new FakeGameService(
			new BidPlacedResponse { SquareIndex = 0, SquareName = "", BidderId = "", BidderName = "", Amount = 0 })
		{
			GameStateOverride = new GameState
			{
				Players = new List<Player>
				{
					new() { Id = "a", Name = "A", Token = "disc" },
					new() { Id = "b", Name = "B", Token = "cross" }
				}
			}
		};

		var hubContext = new CapturingHubContext();
		var registry = new GameSessionRegistry(hubContext, new FakeRepository(), new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		registry.RegisterService(gameId, service);
		registry.AuthenticateConnection(connA, "a");
		registry.MapConnectionToGame(connA, gameId);
		registry.AuthenticateConnection(connB, "b");
		registry.MapConnectionToGame(connB, gameId);

		await service.RaiseGameEventsAsync(new List<AnnouncementDispatch>
		{
			new() { Event = new AnnouncementEvent { Key = "game.rent_paid_self" }, Audience = AnnouncementAudience.Player, PlayerId = "a" },
			new() { Event = new AnnouncementEvent { Key = "game.rent_paid" }, Audience = AnnouncementAudience.AllExcept, PlayerId = "a" },
			new() { Event = new AnnouncementEvent { Key = "game.turn_of" }, Audience = AnnouncementAudience.All }
		});

		// The acting player (a) hears the first-person rent line plus the shared turn line.
		Assert.Equal(
			new[] { "game.rent_paid_self", "game.turn_of" },
			hubContext.KeysSentTo(connA));
		// Everyone else (b) hears the third-person rent line plus the shared turn line.
		Assert.Equal(
			new[] { "game.rent_paid", "game.turn_of" },
			hubContext.KeysSentTo(connB));
	}

	[Fact]
	public async Task ExecuteCommand_ForAnotherPlayer_IsRejected_AndNeverReachesTheGame()
	{
		// The single polymorphic entry point makes this the ONE guard standing between a client and
		// every command in the engine, so it is pinned here: a payload naming somebody else's player
		// id must be refused before the game service ever sees it.
		var (hub, clients, _, _, service) = BuildHubWithService(
			new BidPlacedResponse { SquareIndex = 0, SquareName = "", BidderId = "", BidderName = "", Amount = 0 });

		await hub.ExecuteCommand(new RollDiceCommand { PlayerId = "b" });

		Assert.Equal("CANNOT_EXECUTE_FOR_OTHERS", clients.Caller.LastError());
		Assert.Null(service.LastCommand);
	}

	/// <summary>
	/// The wire contract: a command the client is allowed to send round-trips through the
	/// polymorphic allowlist into its own concrete type, carrying its payload. If a command is
	/// ever added without a <c>[JsonDerivedType]</c> entry, its arm here stops deserializing.
	/// </summary>
	[Theory]
	[InlineData("ROLL_DICE", typeof(RollDiceCommand), "")]
	[InlineData("END_TURN", typeof(EndTurnCommand), "")]
	[InlineData("PAY_HOLDING_RELEASE_COST", typeof(PayReleaseCostCommand), "")]
	[InlineData("USE_RELEASE_PASS", typeof(UseReleasePassCommand), "")]
	[InlineData("FORBIDDEN_CORRECT", typeof(ForbiddenCorrectCommand), ",\"cardSequence\":3")]
	[InlineData("SHEDDING_PLAY", typeof(SheddingPlayCommand), ",\"instanceId\":\"red5#0\"")]
	[InlineData("EXPLODING_NOPE", typeof(ExplodingNopeCommand), ",\"instanceId\":\"nope#0\"")]
	[InlineData("PROPOSE_TRADE", typeof(ProposeTradeCommand), ",\"targetPlayerId\":\"b\"")]
	public void GameCommand_DeserializesFromItsWireDiscriminator(string discriminator, Type expected, string payload)
	{
		var json = $$"""{"$type":"{{discriminator}}","playerId":"a"{{payload}}}""";

		var command = JsonSerializer.Deserialize<GameCommand>(json, WireJson);

		Assert.IsType(expected, command);
		Assert.Equal("a", command!.PlayerId);
		Assert.Equal(discriminator, command.Type);
	}

	/// <summary>
	/// The other half of that contract, and the reason the allowlist is written by hand: the three
	/// commands only <c>GameSessionRegistry</c>'s timers may raise — ending an auction, resolving a
	/// Nope window, expiring a Forbidden turn — are absent from it, so a client cannot forge one
	/// however it shapes the payload. Adding any of them to the list would fail this test.
	/// </summary>
	[Theory]
	[InlineData("END_AUCTION")]
	[InlineData("EXPLODING_RESOLVE_WINDOW")]
	[InlineData("FORBIDDEN_EXPIRE_TURN")]
	public void GameCommand_ServerOnlyCommands_CannotBeDeserializedFromTheWire(string discriminator)
	{
		var json = $$"""{"$type":"{{discriminator}}","playerId":"a"}""";

		Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<GameCommand>(json, WireJson));
	}

	/// <summary>
	/// The bid timer follows the STATE, not whichever command ran. It used to be stopped by the
	/// hub's PassAuction method, which meant every other route out of an auction had to remember
	/// to do it — and left auction-specific code sitting in the one entry point every family's
	/// commands share. It is now reconciled on each state change, beside the Nope window and the
	/// Forbidden clock.
	/// </summary>
	[Fact]
	public void BidTimer_RunsWhileTheAuctionIsLive_AndIsRetiredOnceItResolves()
	{
		var live = new GameState
		{
			ActiveAuction = new AuctionState { SquareIndex = 1, SquareName = "Square 1", InitiatorPlayerId = "a" }
		};
		Assert.Same(live.ActiveAuction, GameSessionRegistry.ShouldRunBidTimer(live));

		// Resolved (a bid won it, or the last rival passed): IsActive goes false and the timer
		// must not keep ticking against a finished auction.
		var resolved = new GameState
		{
			ActiveAuction = new AuctionState
			{
				SquareIndex = 1, SquareName = "Square 1", InitiatorPlayerId = "a", IsActive = false
			}
		};
		Assert.Null(GameSessionRegistry.ShouldRunBidTimer(resolved));

		// And an ordinary turn in any family — no auction at all — never arms it.
		Assert.Null(GameSessionRegistry.ShouldRunBidTimer(new GameState()));
		Assert.Null(GameSessionRegistry.ShouldRunBidTimer(null));
	}

	/// <summary>Deserializes the way SignalR's JSON protocol does (camelCase properties).</summary>
	private static readonly JsonSerializerOptions WireJson =
		new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

	[Fact]
	public async Task CreateGameLobby_PersistsLobbySettings_NotJustTheDefaults()
	{
		// Regression: the lobby's smallBuilding rules (Free Parking jackpot, starting money, GO
		// bonus…) were silently dropped because CreateGameLobby built the GameDocument
		// without copying request.Settings, so every game ran with default settings
		// (FreeParkingJackpot = false → taxes went to the bank instead of the pot).
		var repository = new CapturingRepository();
		var registry = new GameSessionRegistry(new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = new GameHub(
			repository,
			new FakeGameServiceFactory(),
			new FakeAuctionTimer(),
			new CorroPackageStore(new CompositeSoundPackProvider(new DefaultSoundPackProvider())),
			TestFixtures.NewPackageRestorer(),
			registry,
			NullLogger<GameHub>.Instance);
		hub.Clients = new FakeClients();
		hub.Context = new FakeCallerContext("c-" + Guid.NewGuid().ToString("N"));

		var settings = new GameSettings { FreeParkingJackpot = true, StartingMoney = 2000, GoBonus = 400 };
		await hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "Host",
			HostToken = "disc",
			Board = "Test board",
			Settings = settings
		});

		Assert.NotNull(repository.Created);
		Assert.True(repository.Created!.Settings.FreeParkingJackpot);
		Assert.Equal(2000, repository.Created.Settings.StartingMoney);
		Assert.Equal(400, repository.Created.Settings.GoBonus);
	}

	[Fact]
	public async Task CreateGameLobby_WithoutSettings_FallsBackToDefaults()
	{
		var repository = new CapturingRepository();
		var registry = new GameSessionRegistry(new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = new GameHub(
			repository,
			new FakeGameServiceFactory(),
			new FakeAuctionTimer(),
			new CorroPackageStore(new CompositeSoundPackProvider(new DefaultSoundPackProvider())),
			TestFixtures.NewPackageRestorer(),
			registry,
			NullLogger<GameHub>.Instance);
		hub.Clients = new FakeClients();
		hub.Context = new FakeCallerContext("c-" + Guid.NewGuid().ToString("N"));

		await hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "Host",
			HostToken = "disc",
			Board = "Test board",
			Settings = null
		});

		Assert.NotNull(repository.Created);
		Assert.False(repository.Created!.Settings.FreeParkingJackpot);
		Assert.Equal(1500, repository.Created.Settings.StartingMoney);
	}

	[Fact]
	public async Task CreateGameLobby_NormalizesTheHostNameBeforePersistence()
	{
		var repository = new CapturingRepository();
		var registry = new GameSessionRegistry(new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out _);

		await hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "  Host  ", HostToken = "disc", Board = "Test board",
		});

		Assert.Equal("Host", Assert.Single(repository.Created!.Players).Name);
	}

	[Fact]
	public async Task CreateGameLobby_AcceptsAndNormalizesLocalizedBoardNames()
	{
		var repository = new CapturingRepository();
		var registry = new GameSessionRegistry(new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out _);

		await hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "Host",
			HostToken = "disc",
			Board = "  Taller Galáctico  ",
			Language = "ES-es",
		});

		Assert.Equal("Taller Galáctico", repository.Created!.Board);
		Assert.Equal("es", repository.Created.Language);
	}

	[Fact]
	public async Task CreateGameLobby_RejectsInvalidNamesWithoutPersisting()
	{
		var repository = new CapturingRepository();
		var registry = new GameSessionRegistry(new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out var clients);

		await hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "bad\nname", HostToken = "disc", Board = "Test board",
		});

		Assert.Null(repository.Created);
		Assert.True(clients.Caller.Received("Error"));
	}

	[Fact]
	public async Task CreateGameLobby_RejectsAnUnknownOrExpiredPackageToken()
	{
		var repository = new CapturingRepository();
		var registry = new GameSessionRegistry(new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out var clients);

		await hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "Host",
			HostToken = "disc",
			Board = "Expired upload",
			PackageToken = Guid.NewGuid().ToString("N"),
		});

		Assert.Null(repository.Created);
		Assert.True(clients.Caller.Received("Error"));
	}

	[Fact]
	public async Task CreateGameLobby_PersistsTheExplicitContentLanguageAndChoices()
	{
		var repository = new CapturingRepository();
		var store = new CorroPackageStore(
			new CompositeSoundPackProvider(new DefaultSoundPackProvider()),
			Path.Combine(Path.GetTempPath(), "corro_language_" + Guid.NewGuid().ToString("N")));
		var token = "forbidden-" + Guid.NewGuid().ToString("N");
		await store.StageFromDirectoryAsync(token, CorroTestPaths.PackageDir("forbidden-words"));
		store.SetOrigin(token, new PackageOrigin { ShippedId = "forbidden-words" });
		var registry = new GameSessionRegistry(
			new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out _, store);

		await hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "Host",
			HostToken = "disc",
			Board = "Forbidden Words",
			PackageToken = token,
			Language = "es-ES",
			MaxPlayers = 4,
			TeamCount = 2,
		});

		Assert.Equal("es", repository.Created!.Language);
		Assert.Equal(new[] { "en", "es" }, repository.Created.ContentLanguages);
		store.Release(token);
	}

	[Fact]
	public async Task CreateGameLobby_RejectsAContentLanguageOutsideThePackage()
	{
		var repository = new CapturingRepository();
		var store = new CorroPackageStore(
			new CompositeSoundPackProvider(new DefaultSoundPackProvider()),
			Path.Combine(Path.GetTempPath(), "corro_language_" + Guid.NewGuid().ToString("N")));
		var token = "forbidden-" + Guid.NewGuid().ToString("N");
		await store.StageFromDirectoryAsync(token, CorroTestPaths.PackageDir("forbidden-words"));
		store.SetOrigin(token, new PackageOrigin { ShippedId = "forbidden-words" });
		var registry = new GameSessionRegistry(
			new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out var clients, store);

		await hub.CreateGameLobby(new CreateGameRequest
		{
			HostName = "Host",
			HostToken = "disc",
			Board = "Forbidden Words",
			PackageToken = token,
			Language = "fr",
			MaxPlayers = 4,
			TeamCount = 2,
		});

		Assert.Null(repository.Created);
		Assert.True(clients.Caller.Received("Error"));
		store.Release(token);
	}

	[Fact]
	public async Task Host_can_change_the_shared_content_language_while_waiting()
	{
		var repository = new CapturingRepository();
		repository.Seed(WaitingForbiddenGame());
		var registry = new GameSessionRegistry(
			new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out var clients);
		registry.MapConnectionToGame(hub.Context.ConnectionId, "g1");
		registry.AuthenticateConnection(hub.Context.ConnectionId, "host");

		await hub.SetContentLanguage(new SetContentLanguageRequest
		{
			GameId = "g1",
			HostId = "host",
			Language = "ES-es",
		});

		Assert.Equal("es", repository.Created!.Language);
		Assert.True(clients.Group("lobby_g1").Received("LobbyUpdated"));
		Assert.True(clients.Group("lobby_g1").Received("ContentLanguageChanged"));
	}

	[Fact]
	public async Task Guest_cannot_change_the_shared_content_language()
	{
		var repository = new CapturingRepository();
		repository.Seed(WaitingForbiddenGame());
		var registry = new GameSessionRegistry(
			new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out var clients);
		registry.MapConnectionToGame(hub.Context.ConnectionId, "g1");
		registry.AuthenticateConnection(hub.Context.ConnectionId, "guest");

		await hub.SetContentLanguage(new SetContentLanguageRequest
		{
			GameId = "g1",
			HostId = "host",
			Language = "es",
		});

		Assert.Equal("en", repository.Created!.Language);
		Assert.True(clients.Caller.Received("Error"));
		Assert.False(clients.Group("lobby_g1").Received("ContentLanguageChanged"));
	}

	[Fact]
	public async Task The_content_language_is_locked_once_the_game_starts()
	{
		var repository = new CapturingRepository();
		repository.Seed(WaitingForbiddenGame() with { Status = GameStatus.Active });
		var registry = new GameSessionRegistry(
			new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out var clients);
		registry.MapConnectionToGame(hub.Context.ConnectionId, "g1");
		registry.AuthenticateConnection(hub.Context.ConnectionId, "host");

		await hub.SetContentLanguage(new SetContentLanguageRequest
		{
			GameId = "g1",
			HostId = "host",
			Language = "es",
		});

		Assert.Equal("en", repository.Created!.Language);
		Assert.True(clients.Caller.Received("Error"));
		Assert.False(clients.Group("lobby_g1").Received("ContentLanguageChanged"));
	}

	// A table outlives the process that staged its board. Reported from a real session: after a
	// restart the roster named every player's piece by its raw id ("stout pint" for stout_pint),
	// because the pieces only ever reached the client through a staged package the server no longer
	// held. Asking through the hub — which has the game document — puts it back.
	[Fact]
	public async Task A_table_gets_its_package_even_after_the_process_forgot_it()
	{
		var repository = new CapturingRepository();
		var store = new CorroPackageStore(
			new CompositeSoundPackProvider(new DefaultSoundPackProvider()),
			Path.Combine(Path.GetTempPath(), "corro_table_pkg_" + Guid.NewGuid().ToString("N")));
		var restorer = new CorroServer.Services.Corro.PackageRestorer(
			store,
			new CorroServer.Services.Corro.ShippedPackageProvider(CorroTestPaths.PackagesRoot()),
			new CorroServer.Services.Corro.LocalFilePackageBlobStore());
		var token = "forbidden-" + Guid.NewGuid().ToString("N");
		await store.StageFromDirectoryAsync(token, CorroTestPaths.PackageDir("forbidden-words"));
		repository.Seed(WaitingForbiddenGame() with
		{
			PackageToken = token,
			ShippedBoardId = "forbidden-words",
		});
		var registry = new GameSessionRegistry(
			new FakeHubContext(), repository, new FakeAuctionTimer(), restorer);
		var hub = CreateLobbyHub(repository, registry, out _, store, restorer);
		registry.MapConnectionToGame(hub.Context.ConnectionId, "g1");
		registry.AuthenticateConnection(hub.Context.ConnectionId, "host");

		var staged = await hub.GetTablePackage();
		Assert.NotEmpty(staged!.Tokens);

		// The process forgets it — a restart, or a staging that expired.
		store.Release(token);
		Assert.Null(store.GetDefinition(token));

		var restored = await hub.GetTablePackage();
		Assert.NotNull(restored);
		Assert.NotEmpty(restored!.Tokens);
		// The SAME token, so the endpoints that serve the package's words and guide by token work
		// again too — that is the other half of what a restart broke.
		Assert.Equal(token, restored.Token);
		store.Release(token);
	}

	[Fact]
	public async Task An_unauthenticated_connection_gets_no_package()
	{
		var repository = new CapturingRepository();
		repository.Seed(WaitingForbiddenGame());
		var registry = new GameSessionRegistry(
			new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out var clients);

		Assert.Null(await hub.GetTablePackage());
		Assert.True(clients.Caller.Received("Error"));
	}

	// A table plays again and again, so the rules it starts from must be editable between matches —
	// the game that just ended is exactly when a group decides that auctions were a mistake.
	[Fact]
	public async Task Host_can_change_the_house_rules_for_the_next_match()
	{
		var repository = new CapturingRepository();
		repository.Seed(WaitingForbiddenGame());
		var registry = new GameSessionRegistry(
			new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out var clients);
		registry.MapConnectionToGame(hub.Context.ConnectionId, "g1");
		registry.AuthenticateConnection(hub.Context.ConnectionId, "host");

		await hub.SetTableRules(new SetTableRulesRequest
		{
			GameId = "g1",
			HostId = "host",
			RuleValues = new() { ["auctions"] = JsonSerializer.SerializeToElement(false) },
		});

		Assert.False(repository.Created!.RuleValues!["auctions"].GetBoolean());
		Assert.True(clients.Group("lobby_g1").Received("LobbyUpdated"));
	}

	[Fact]
	public async Task Guest_cannot_change_the_house_rules()
	{
		var repository = new CapturingRepository();
		repository.Seed(WaitingForbiddenGame());
		var registry = new GameSessionRegistry(
			new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out var clients);
		registry.MapConnectionToGame(hub.Context.ConnectionId, "g1");
		registry.AuthenticateConnection(hub.Context.ConnectionId, "guest");

		await hub.SetTableRules(new SetTableRulesRequest
		{
			GameId = "g1",
			HostId = "host",
			RuleValues = new() { ["auctions"] = JsonSerializer.SerializeToElement(false) },
		});

		Assert.Null(repository.Created!.RuleValues);
		Assert.True(clients.Caller.Received("Error"));
	}

	[Fact]
	public async Task The_house_rules_are_locked_while_a_match_is_running()
	{
		// Changing them under a live game would mean two different rulebooks in one match.
		var repository = new CapturingRepository();
		repository.Seed(WaitingForbiddenGame() with { Status = GameStatus.Active });
		var registry = new GameSessionRegistry(
			new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out var clients);
		registry.MapConnectionToGame(hub.Context.ConnectionId, "g1");
		registry.AuthenticateConnection(hub.Context.ConnectionId, "host");

		await hub.SetTableRules(new SetTableRulesRequest
		{
			GameId = "g1",
			HostId = "host",
			RuleValues = new() { ["auctions"] = JsonSerializer.SerializeToElement(false) },
		});

		Assert.Null(repository.Created!.RuleValues);
		Assert.True(clients.Caller.Received("Error"));
	}

	[Fact]
	public async Task Reloaded_waiting_player_rejoins_live_lobby_broadcasts()
	{
		var repository = new CapturingRepository();
		repository.Seed(WaitingForbiddenGame());
		var registry = new GameSessionRegistry(
			new FakeHubContext(), repository, new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		var hub = CreateLobbyHub(repository, registry, out _);

		var game = await hub.ReconnectLobby("g1", "host", "secret");

		Assert.Equal("en", game.Language);
		Assert.Equal(new[] { "en", "es" }, game.ContentLanguages);
		Assert.Contains(hub.Context.ConnectionId, registry.LobbyConnectionIds("g1"));
	}

	private static GameDocument WaitingForbiddenGame() => new()
	{
		Id = "game-g1",
		GameId = "g1",
		Status = GameStatus.WaitingForPlayers,
		HostId = "host",
		InviteCode = "INVITE",
		Language = "en",
		ContentLanguages = new() { "en", "es" },
		Players = new()
		{
			new LobbyPlayer
			{
				Id = "host",
				Name = "Host",
				Token = "disc",
				IsHost = true,
				IsReady = true,
				PlayerSecretId = "secret",
			},
		},
	};

	private static GameHub CreateLobbyHub(
		IGameRepository repository,
		GameSessionRegistry registry,
		out FakeClients clients,
		CorroPackageStore? packageStore = null,
		CorroServer.Services.Corro.PackageRestorer? restorer = null)
	{
		clients = new FakeClients();
		return new GameHub(
			repository,
			new FakeGameServiceFactory(),
			new FakeAuctionTimer(),
			packageStore ?? new CorroPackageStore(new CompositeSoundPackProvider(new DefaultSoundPackProvider())),
			restorer ?? TestFixtures.NewPackageRestorer(),
			registry,
			NullLogger<GameHub>.Instance)
		{
			Clients = clients,
			Context = new FakeCallerContext("c-" + Guid.NewGuid().ToString("N")),
			Groups = new FakeGroupManager(),
		};
	}

	// ── Test harness ──────────────────────────────────────────────

	private static (GameHub hub, FakeClients clients, string gameId, string connId) BuildHub(ServerResponse response)
	{
		var (hub, clients, gameId, connId, _) = BuildHubWithService(new FakeGameService(response));
		return (hub, clients, gameId, connId);
	}

	private static (GameHub hub, FakeClients clients, string gameId) BuildHub(FakeGameService service)
	{
		var (hub, clients, gameId, _, _) = BuildHubWithService(service);
		return (hub, clients, gameId);
	}

	private static (GameHub hub, FakeClients clients, string gameId, string connId, FakeGameService service) BuildHubWithService(ServerResponse response)
		=> BuildHubWithService(new FakeGameService(response));

	private static (GameHub hub, FakeClients clients, string gameId, string connId, FakeGameService service) BuildHubWithService(FakeGameService service)
	{
		var gameId = "g-" + Guid.NewGuid().ToString("N");
		var connId = "c-" + Guid.NewGuid().ToString("N");
		const string playerId = "a";

		// Seed the live-session registry so IsConnectionAuthenticated passes and the game service is
		// resolvable. The response the fake service returns drives routing.
		var registry = new GameSessionRegistry(new FakeHubContext(), new FakeRepository(), new FakeAuctionTimer(), TestFixtures.NewPackageRestorer());
		registry.RegisterService(gameId, service);
		registry.AuthenticateConnection(connId, playerId);
		registry.MapConnectionToGame(connId, gameId);

		var hub = new GameHub(
			new FakeRepository(),
			new FakeGameServiceFactory(),
			new FakeAuctionTimer(),
			new CorroPackageStore(new CompositeSoundPackProvider(new DefaultSoundPackProvider())),
			TestFixtures.NewPackageRestorer(),
			registry,
			NullLogger<GameHub>.Instance);

		var clients = new FakeClients();
		hub.Clients = clients;
		hub.Context = new FakeCallerContext(connId);

		return (hub, clients, gameId, connId, service);
	}

	// ── SignalR fakes ───────────────────────────────────────────────────────

	/// <summary>Records every <c>SendCoreAsync</c> method name it receives.</summary>
	private sealed class RecordingProxy : ISingleClientProxy
	{
		private readonly List<string> _methods = new();
		private readonly List<string> _errors = new();
		public bool Received(string method) => _methods.Contains(method);

		/// <summary>The last error CODE pushed to this target, or null if none — the hub sends
		/// rejections as <c>Error</c> with the code as its single argument.</summary>
		public string? LastError() => _errors.Count > 0 ? _errors[^1] : null;

		public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
		{
			_methods.Add(method);
			if (method == "Error" && args is [string code, ..])
			{
				_errors.Add(code);
			}
			return Task.CompletedTask;
		}
		public Task<T> InvokeCoreAsync<T>(string method, object?[] args, CancellationToken cancellationToken = default)
			=> throw new NotImplementedException();
	}

	/// <summary>
	/// Fake client set. Returns a stable recording proxy per logical target (caller, each
	/// group, etc.) so a test can assert which one received a given Hub method.
	/// </summary>
	private sealed class FakeClients : IHubCallerClients
	{
		private readonly RecordingProxy _caller = new();
		private readonly Dictionary<string, RecordingProxy> _groups = new();
		private readonly RecordingProxy _shared = new();

		/// <summary>Recording proxy for the caller (test-facing accessor).</summary>
		public RecordingProxy Caller => _caller;

		/// <summary>Recording proxy for a group, stable per group name (test-facing accessor).</summary>
		public RecordingProxy Group(string groupName)
		{
			if (!_groups.TryGetValue(groupName, out var proxy))
			{
				proxy = new RecordingProxy();
				_groups[groupName] = proxy;
			}
			return proxy;
		}

		ISingleClientProxy IHubCallerClients.Caller => _caller;
		ISingleClientProxy IHubCallerClients.Client(string connectionId) => _shared;
		IClientProxy IHubCallerClients<IClientProxy>.Caller => _caller;
		IClientProxy IHubCallerClients<IClientProxy>.Others => _shared;
		IClientProxy IHubCallerClients<IClientProxy>.OthersInGroup(string groupName) => _shared;
		IClientProxy IHubClients<IClientProxy>.All => _shared;
		IClientProxy IHubClients<IClientProxy>.AllExcept(IReadOnlyList<string> excludedConnectionIds) => _shared;
		IClientProxy IHubClients<IClientProxy>.Client(string connectionId) => _shared;
		IClientProxy IHubClients<IClientProxy>.Clients(IReadOnlyList<string> connectionIds) => _shared;
		IClientProxy IHubClients<IClientProxy>.Group(string groupName) => Group(groupName);
		IClientProxy IHubClients<IClientProxy>.GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => _shared;
		IClientProxy IHubClients<IClientProxy>.Groups(IReadOnlyList<string> groupNames) => _shared;
		IClientProxy IHubClients<IClientProxy>.User(string userId) => _shared;
		IClientProxy IHubClients<IClientProxy>.Users(IReadOnlyList<string> userIds) => _shared;
	}

	private sealed class FakeCallerContext : HubCallerContext
	{
		public FakeCallerContext(string connectionId) => ConnectionId = connectionId;
		public override string ConnectionId { get; }
		public override string? UserIdentifier => null;
		public override System.Security.Claims.ClaimsPrincipal? User => null;
		public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
		public override Microsoft.AspNetCore.Http.Features.IFeatureCollection Features { get; }
			= new Microsoft.AspNetCore.Http.Features.FeatureCollection();
		public override CancellationToken ConnectionAborted => CancellationToken.None;
		public override void Abort() { }
	}

	// ── Service fakes (only the members used by ExecuteCommand do anything) ──

	private sealed class FakeGameService : IGameService
	{
		private readonly ServerResponse _response;
		public FakeGameService(ServerResponse response) => _response = response;

		public bool NotifyStateChangedCalled { get; private set; }
		public GameState? GameStateOverride { get; init; }
		public GameCommand? LastCommand { get; private set; }

		public Task<ServerResponse> ExecuteCommandAsync(GameCommand command)
		{
			LastCommand = command;
			return Task.FromResult(_response);
		}
		public Task NotifyStateChangedAsync() { NotifyStateChangedCalled = true; return Task.CompletedTask; }
		public Task SetPlayerConnectedAsync(string playerId, bool connected) => Task.CompletedTask;

		public GameState? GameState => GameStateOverride;
		public GameSettings Settings => new();
		public string GameId => "g";
		public bool IsGameActive => true;
		public Task<GameState> GetGameStateAsync() => Task.FromResult(new GameState());
		public Task InitializeFromDefinitionAsync(List<Player> players, CorroServer.Models.Corro.GameDefinition definition, string lang = "en", GameSettings? settings = null, bool raceTeams = false, Dictionary<string, System.Text.Json.JsonElement>? ruleValues = null, List<List<string>>? teams = null) => Task.CompletedTask;
		public void ConfigureSettings(GameSettings settings) { }
		public Task EndGameAsync() => Task.CompletedTask;
		public Task RestoreGameAsync(GameState savedState) => Task.CompletedTask;
		public void AttachPackageDefinition(CorroServer.Models.Corro.GameDefinition definition) { }
		public event Func<GameState, Task>? OnGameStateChanged { add { } remove { } }

		// Real, raisable event so the Hub's announcement-batch send path can be driven.
		private Func<IReadOnlyList<AnnouncementDispatch>, Task>? _onGameEvents;
		public event Func<IReadOnlyList<AnnouncementDispatch>, Task>? OnGameEvents
		{
			add => _onGameEvents += value;
			remove => _onGameEvents -= value;
		}
		public Task RaiseGameEventsAsync(IReadOnlyList<AnnouncementDispatch> batch)
			=> _onGameEvents?.Invoke(batch) ?? Task.CompletedTask;

		public event Func<Square, Task>? OnSquareChanged { add { } remove { } }
		public event Func<CardDrawnNotification, Task>? OnCardDrawn { add { } remove { } }
	}

	private sealed class FakeGameServiceFactory : IGameServiceFactory
	{
		public IGameService Create(string? gameId = null) => new FakeGameService(
			new BidPlacedResponse { SquareIndex = 0, SquareName = "", BidderId = "", BidderName = "", Amount = 0 });
	}

	private sealed class FakeAuctionTimer : IAuctionTimerService
	{
		public void StartTimers(string gameId, GameSettings settings, AuctionState auction) { }
		public void StopTimers(string gameId) { }
		public event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick { add { } remove { } }
		public event Func<string, Task>? OnBidTimeout { add { } remove { } }
	}

	/// <summary>Auction timer whose OnBidTimeout can be raised, to drive the registry's end-auction path.</summary>
	private sealed class RaisableAuctionTimer : IAuctionTimerService
	{
		public void StartTimers(string gameId, GameSettings settings, AuctionState auction) { }
		public void StopTimers(string gameId) { }
		public event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick { add { } remove { } }
		public event Func<string, Task>? OnBidTimeout;
		public Task RaiseBidTimeout(string gameId) => OnBidTimeout?.Invoke(gameId) ?? Task.CompletedTask;
	}

	private sealed class FakeRepository : IGameRepository
	{
		public Task<GameDocument?> LoadGameAsync(string gameId) => Task.FromResult<GameDocument?>(null);
		public Task<bool> DeleteGameAsync(string gameId) => Task.FromResult(true);
		public async IAsyncEnumerable<GameDocument> GetGamesLastUpdatedBeforeAsync(DateTime cutoffUtc, int maxCount, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
		{
			await Task.CompletedTask;
			yield break;
		}
		public Task<bool> HasPackageReferenceAsync(string? packageToken, string? packageBlobKey, CancellationToken ct = default)
			=> Task.FromResult(false);
		public Task<IReadOnlySet<string>> GetReferencedPackageBlobKeysAsync(CancellationToken ct = default)
			=> Task.FromResult<IReadOnlySet<string>>(new HashSet<string>());
		public Task<GameDocument?> GetByInviteCodeAsync(string inviteCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument> CreateGameAsync(GameDocument game) => Task.FromResult(game);
		public Task<GameDocument> UpdateGameAsync(GameDocument game) => Task.FromResult(game);

		private static GameDocument NewDoc() => new()
		{
			Id = "id",
			GameId = "g",
			Status = GameStatus.Active,
			HostId = "h",
			InviteCode = "INV"
		};
	}

	/// <summary>Repository that records the document passed to <c>CreateGameAsync</c>.</summary>
	private sealed class CapturingRepository : IGameRepository
	{
		public GameDocument? Created { get; private set; }
		public void Seed(GameDocument game) => Created = game;
		public Task<GameDocument?> LoadGameAsync(string gameId)
			=> Task.FromResult(Created?.GameId == gameId ? Created : null);
		public Task<bool> DeleteGameAsync(string gameId) => Task.FromResult(true);
		public async IAsyncEnumerable<GameDocument> GetGamesLastUpdatedBeforeAsync(DateTime cutoffUtc, int maxCount, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
		{
			await Task.CompletedTask;
			yield break;
		}
		public Task<bool> HasPackageReferenceAsync(string? packageToken, string? packageBlobKey, CancellationToken ct = default)
			=> Task.FromResult(false);
		public Task<IReadOnlySet<string>> GetReferencedPackageBlobKeysAsync(CancellationToken ct = default)
			=> Task.FromResult<IReadOnlySet<string>>(new HashSet<string>());
		public Task<GameDocument?> GetByInviteCodeAsync(string inviteCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument> CreateGameAsync(GameDocument game)
		{
			Created = game;
			return Task.FromResult(game);
		}
		public Task<GameDocument> UpdateGameAsync(GameDocument game)
		{
			Created = game;
			return Task.FromResult(game);
		}
	}

	private sealed class FakeHubContext : IHubContext<GameHub>
	{
		private readonly FakeHubClients _clients = new();
		public IHubClients Clients => _clients;
		public IGroupManager Groups { get; } = new FakeGroupManager();
		/// <summary>Recording proxy that backs every client target (test-facing accessor).</summary>
		public RecordingProxy GroupProxy => _clients.Proxy;
	}

	private sealed class FakeHubClients : IHubClients
	{
		private readonly RecordingProxy _proxy = new();
		public RecordingProxy Proxy => _proxy;
		ISingleClientProxy IHubClients.Client(string connectionId) => _proxy;
		IClientProxy IHubClients<IClientProxy>.All => _proxy;
		IClientProxy IHubClients<IClientProxy>.AllExcept(IReadOnlyList<string> excludedConnectionIds) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Client(string connectionId) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Clients(IReadOnlyList<string> connectionIds) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Group(string groupName) => _proxy;
		IClientProxy IHubClients<IClientProxy>.GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Groups(IReadOnlyList<string> groupNames) => _proxy;
		IClientProxy IHubClients<IClientProxy>.User(string userId) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Users(IReadOnlyList<string> userIds) => _proxy;
	}

	private sealed class FakeGroupManager : IGroupManager
	{
		public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) => Task.CompletedTask;
		public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) => Task.CompletedTask;
	}

	// ── Capturing hub context (records which connections received which payload) ──

	/// <summary>
	/// Hub context whose <c>Clients.Clients(connectionIds)</c> records the exact connection
	/// set, method and payload of every send, so a test can assert the per-connection
	/// "GameEvents" batches the announcement send path produces.
	/// </summary>
	private sealed class CapturingHubContext : IHubContext<GameHub>
	{
		private readonly CapturingHubClients _clients = new();
		public IHubClients Clients => _clients;
		public IGroupManager Groups { get; } = new FakeGroupManager();

		/// <summary>Translation keys delivered to a given connection across every "GameEvents" send.</summary>
		public string[] KeysSentTo(string connectionId) => _clients.Sends
			.Where(s => s.Method == "GameEvents" && s.Connections.Contains(connectionId))
			.SelectMany(s => ((IEnumerable<AnnouncementEvent>)s.Args[0]!).Select(e => e.Key))
			.ToArray();
	}

	private sealed record CapturedSend(IReadOnlyList<string> Connections, string Method, object?[] Args);

	private sealed class CapturingHubClients : IHubClients
	{
		public List<CapturedSend> Sends { get; } = new();

		private IClientProxy Capture(IReadOnlyList<string> connections) => new CapturingProxy(connections, Sends);
		private IClientProxy Noop => new CapturingProxy(Array.Empty<string>(), Sends);

		ISingleClientProxy IHubClients.Client(string connectionId) => new CapturingProxy(new[] { connectionId }, Sends);
		IClientProxy IHubClients<IClientProxy>.All => Noop;
		IClientProxy IHubClients<IClientProxy>.AllExcept(IReadOnlyList<string> excludedConnectionIds) => Noop;
		IClientProxy IHubClients<IClientProxy>.Client(string connectionId) => new CapturingProxy(new[] { connectionId }, Sends);
		IClientProxy IHubClients<IClientProxy>.Clients(IReadOnlyList<string> connectionIds) => Capture(connectionIds);
		IClientProxy IHubClients<IClientProxy>.Group(string groupName) => Noop;
		IClientProxy IHubClients<IClientProxy>.GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => Noop;
		IClientProxy IHubClients<IClientProxy>.Groups(IReadOnlyList<string> groupNames) => Noop;
		IClientProxy IHubClients<IClientProxy>.User(string userId) => Noop;
		IClientProxy IHubClients<IClientProxy>.Users(IReadOnlyList<string> userIds) => Noop;
	}

	/// <summary>Client proxy that appends a <see cref="CapturedSend"/> for each send it receives.</summary>
	private sealed class CapturingProxy : ISingleClientProxy
	{
		private readonly IReadOnlyList<string> _connections;
		private readonly List<CapturedSend> _sends;
		public CapturingProxy(IReadOnlyList<string> connections, List<CapturedSend> sends)
		{
			_connections = connections;
			_sends = sends;
		}
		public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
		{
			_sends.Add(new CapturedSend(_connections, method, args));
			return Task.CompletedTask;
		}
		public Task<T> InvokeCoreAsync<T>(string method, object?[] args, CancellationToken cancellationToken = default)
			=> throw new NotImplementedException();
	}
}
