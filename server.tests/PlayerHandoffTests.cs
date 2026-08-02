using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Rules;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Leaving the waiting room for the board is a page NAVIGATION, not a departure: the old page's
/// connection dies and the board's authenticates a moment later. Read literally that is a drop
/// followed by a reconnection, so the whole table heard "X went away" and the player themselves
/// "you have reconnected to the game" — earcon included — seconds into a game nobody had left.
///
/// The page therefore warns the server before navigating, and that warning covers exactly one
/// connection's death. A genuine drop, which never announces itself, still counts.
/// </summary>
public class PlayerHandoffTests
{
	private const string GameId = "game-handoff";
	private const string PlayerId = "b";

	[Fact]
	public async Task A_declared_handover_leaves_the_player_present_and_says_nothing()
	{
		var h = await BuildAsync();
		await h.Hub.DeclareHandoff();

		await h.Hub.OnDisconnectedAsync(null);

		Assert.True(h.Service.GameState!.Players.First(p => p.Id == PlayerId).IsConnected);
		Assert.Empty(h.Announced);
	}

	[Fact]
	public async Task An_unannounced_drop_still_marks_the_player_away_and_is_heard()
	{
		var h = await BuildAsync();

		await h.Hub.OnDisconnectedAsync(null);

		Assert.False(h.Service.GameState!.Players.First(p => p.Id == PlayerId).IsConnected);
		Assert.Contains(h.Announced, d => d.Event.Key == "game.player_disconnected");
	}

	[Fact]
	public async Task The_warning_covers_one_death_only_so_the_next_real_drop_counts()
	{
		// The regression this guards: a warning that outlived its own connection would silence the
		// player's real disconnection later in the game, leaving the table waiting on a ghost.
		var h = await BuildAsync();
		await h.Hub.DeclareHandoff();
		await h.Hub.OnDisconnectedAsync(null);

		// The board's page arrives, then that connection drops for real.
		h.Reconnect("connection-board");
		await h.Hub.OnDisconnectedAsync(null);

		Assert.False(h.Service.GameState!.Players.First(p => p.Id == PlayerId).IsConnected);
		Assert.Contains(h.Announced, d => d.Event.Key == "game.player_disconnected");
	}

	[Fact]
	public async Task An_unauthenticated_connection_cannot_silence_anyone()
	{
		// The warning is scoped to the caller's own seat; a nameless connection has none to hand over.
		var h = await BuildAsync(authenticate: false);
		await h.Hub.DeclareHandoff();
		h.Reconnect("connection-authenticated");

		await h.Hub.OnDisconnectedAsync(null);

		Assert.False(h.Service.GameState!.Players.First(p => p.Id == PlayerId).IsConnected);
	}

	// ── Harness ───────────────────────────────────────────────────────────────

	private sealed class Harness
	{
		public required GameHub Hub { get; init; }
		public required GameService Service { get; init; }
		public required GameSessionRegistry Registry { get; init; }
		public required List<AnnouncementDispatch> Announced { get; init; }

		/// <summary>Authenticates a fresh connection for the same player, as the next page does.</summary>
		public void Reconnect(string connectionId)
		{
			Registry.MapConnectionToGame(connectionId, GameId);
			Registry.AuthenticateConnection(connectionId, PlayerId);
			Hub.Context = new FakeCallerContext(connectionId);
		}
	}

	private static async Task<Harness> BuildAsync(bool authenticate = true)
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.FixtureDir("corro-classic"));
		var service = new GameService(new CorroRulebook(), new AuctionRulebook());
		await service.InitializeFromDefinitionAsync(
			new List<Player>
			{
				new() { Id = "a", Name = "Ana", Token = "disc" },
				new() { Id = PlayerId, Name = "Bob", Token = "star" },
			},
			definition,
			"es");
		var announced = new List<AnnouncementDispatch>();
		service.OnGameEvents += batch => { announced.AddRange(batch); return Task.CompletedTask; };

		var registry = new GameSessionRegistry(
			new NoopHubContext(), new InMemoryGameRepository(), new NoopAuctionTimer(),
			TestFixtures.NewPackageRestorer());
		registry.RegisterService(GameId, service);

		const string connectionId = "connection-waiting-room";
		registry.MapConnectionToGame(connectionId, GameId);
		if (authenticate)
		{
			registry.AuthenticateConnection(connectionId, PlayerId);
		}

		var hub = new GameHub(
			new InMemoryGameRepository(),
			gameServiceFactory: null!,
			new NoopAuctionTimer(),
			packageStore: null!,
			packageRestorer: null!,
			registry,
			NullLogger<GameHub>.Instance)
		{
			Clients = new NoopHubCallerClients(),
			Context = new FakeCallerContext(connectionId),
			Groups = new NoopGroupManager(),
		};

		return new Harness { Hub = hub, Service = service, Registry = registry, Announced = announced };
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

	private sealed class NoopAuctionTimer : IAuctionTimerService
	{
		public event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick { add { } remove { } }
		public event Func<string, Task>? OnBidTimeout { add { } remove { } }
		public void StartTimers(string gameId, GameSettings settings, AuctionState auction) { }
		public void StopTimers(string gameId) { }
	}

	private sealed class NoopProxy : ISingleClientProxy
	{
		public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
			=> Task.CompletedTask;
		public Task<T> InvokeCoreAsync<T>(string method, object?[] args, CancellationToken cancellationToken = default)
			=> throw new NotImplementedException();
	}

	private sealed class NoopHubContext : IHubContext<GameHub>
	{
		public IHubClients Clients { get; } = new NoopHubClients();
		public IGroupManager Groups { get; } = new NoopGroupManager();
	}

	private sealed class NoopHubClients : IHubClients
	{
		private readonly NoopProxy _proxy = new();
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

	private sealed class NoopHubCallerClients : IHubCallerClients
	{
		private readonly NoopProxy _proxy = new();
		ISingleClientProxy IHubCallerClients.Caller => _proxy;
		ISingleClientProxy IHubCallerClients.Client(string connectionId) => _proxy;
		IClientProxy IHubCallerClients<IClientProxy>.Caller => _proxy;
		IClientProxy IHubCallerClients<IClientProxy>.Others => _proxy;
		IClientProxy IHubCallerClients<IClientProxy>.OthersInGroup(string groupName) => _proxy;
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

	private sealed class NoopGroupManager : IGroupManager
	{
		public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
			=> Task.CompletedTask;
		public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
			=> Task.CompletedTask;
	}
}
