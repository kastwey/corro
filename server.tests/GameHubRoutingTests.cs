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
			GameStateOverride = new GameState { CurrentTurn = "a" }
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
	public async Task PayReleaseCost_RoutesPayReleaseCostCommand_WithCallerPlayerId()
	{
		var (hub, _, _, _, service) = BuildHubWithService(
			new BidPlacedResponse { SquareIndex = 0, SquareName = "", BidderId = "", BidderName = "", Amount = 0 });

		await hub.PayReleaseCost("a");

		var command = Assert.IsType<PayReleaseCostCommand>(service.LastCommand);
		Assert.Equal("a", command.PlayerId);
	}

	[Fact]
	public async Task UseReleasePass_RoutesUseReleasePassCommand_WithCallerPlayerId()
	{
		var (hub, _, _, _, service) = BuildHubWithService(
			new BidPlacedResponse { SquareIndex = 0, SquareName = "", BidderId = "", BidderName = "", Amount = 0 });

		await hub.UseReleasePass("a");

		var command = Assert.IsType<UseReleasePassCommand>(service.LastCommand);
		Assert.Equal("a", command.PlayerId);
	}

	[Fact]
	public async Task RollDice_RoutesRollDiceCommand_WithCallerPlayerId()
	{
		// Pins RollDice's routing so it can be simplified to delegate to ExecuteCommand (like the
		// other command hub methods) instead of re-implementing auth/lookup/dispatch itself.
		var (hub, _, _, _, service) = BuildHubWithService(
			new BidPlacedResponse { SquareIndex = 0, SquareName = "", BidderId = "", BidderName = "", Amount = 0 });

		await hub.RollDice("a");

		var command = Assert.IsType<RollDiceCommand>(service.LastCommand);
		Assert.Equal("a", command.PlayerId);
	}

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

	private static GameHub CreateLobbyHub(
		IGameRepository repository,
		GameSessionRegistry registry,
		out FakeClients clients)
	{
		clients = new FakeClients();
		return new GameHub(
			repository,
			new FakeGameServiceFactory(),
			new FakeAuctionTimer(),
			new CorroPackageStore(new CompositeSoundPackProvider(new DefaultSoundPackProvider())),
			TestFixtures.NewPackageRestorer(),
			registry,
			NullLogger<GameHub>.Instance)
		{
			Clients = clients,
			Context = new FakeCallerContext("c-" + Guid.NewGuid().ToString("N")),
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
		public bool Received(string method) => _methods.Contains(method);
		public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
		{
			_methods.Add(method);
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
		public Task<GameDocument?> LoadGameAsync(string gameId) => Task.FromResult<GameDocument?>(null);
		public Task<bool> DeleteGameAsync(string gameId) => Task.FromResult(true);
		public Task<GameDocument?> GetByInviteCodeAsync(string inviteCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument> CreateGameAsync(GameDocument game)
		{
			Created = game;
			return Task.FromResult(game);
		}
		public Task<GameDocument> UpdateGameAsync(GameDocument game) => Task.FromResult(game);
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
