using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using Microsoft.AspNetCore.SignalR;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Unit tests for <see cref="GameSessionRegistry"/>, the injected singleton that now owns the live
/// game/connection state that used to sit in <see cref="GameHub"/> statics. Being a plain injectable
/// object, its lifecycle behaviour (game-over teardown, connection resolution) is testable directly.
/// </summary>
public class GameSessionRegistryTests
{
	private static GameSessionRegistry NewRegistry(out RecordingTimer timer, out RecordingRepo repo)
	{
		timer = new RecordingTimer();
		repo = new RecordingRepo();
		return new GameSessionRegistry(new NoopHubContext(), repo, timer, TestFixtures.NewPackageRestorer());
	}

	[Fact]
	public void ConnectionsForPlayer_returns_only_that_players_connections_in_that_game()
	{
		var reg = NewRegistry(out _, out _);
		reg.AuthenticateConnection("c1", "a"); reg.MapConnectionToGame("c1", "g1");
		reg.AuthenticateConnection("c2", "a"); reg.MapConnectionToGame("c2", "g1"); // a's 2nd tab
		reg.AuthenticateConnection("c3", "b"); reg.MapConnectionToGame("c3", "g1"); // another player
		reg.AuthenticateConnection("c4", "a"); reg.MapConnectionToGame("c4", "g2"); // a, other game

		Assert.Equal(new[] { "c1", "c2" }, reg.ConnectionsForPlayer("a", "g1").OrderBy(x => x));
		Assert.Empty(reg.ConnectionsForPlayer(null, "g1"));
	}

	[Fact]
	public void ConnectedPlayerIds_returns_the_distinct_authenticated_players_of_a_game()
	{
		var reg = NewRegistry(out _, out _);
		reg.AuthenticateConnection("c1", "a"); reg.MapConnectionToGame("c1", "g1");
		reg.AuthenticateConnection("c2", "a"); reg.MapConnectionToGame("c2", "g1"); // duplicate player
		reg.AuthenticateConnection("c3", "b"); reg.MapConnectionToGame("c3", "g1");
		reg.AuthenticateConnection("c4", "c"); reg.MapConnectionToGame("c4", "g2"); // other game

		Assert.Equal(new[] { "a", "b" }, reg.ConnectedPlayerIds("g1").OrderBy(x => x));
	}

	[Fact]
	public async Task CleanupIfGameOver_tears_the_game_down_when_it_is_over()
	{
		var reg = NewRegistry(out var timer, out var repo);
		var service = new FakeService(gameOver: true);
		reg.RegisterService("g1", service);

		await reg.CleanupIfGameOverAsync("g1", service);

		Assert.False(reg.HasService("g1"));          // removed from memory
		Assert.True(service.Ended);                   // EndGameAsync called
		Assert.Contains("g1", timer.Stopped);         // auction timers stopped
		Assert.Contains("g1", repo.Deleted);          // deleted from storage (won game, no resume)
	}

	[Fact]
	public async Task CleanupIfGameOver_keeps_the_game_when_it_is_not_over()
	{
		var reg = NewRegistry(out var timer, out var repo);
		var service = new FakeService(gameOver: false);
		reg.RegisterService("g1", service);

		await reg.CleanupIfGameOverAsync("g1", service);

		Assert.True(reg.HasService("g1"));            // still live
		Assert.False(service.Ended);
		Assert.Empty(repo.Deleted);
	}

	[Fact]
	public async Task TearDownGameAsync_stops_timers_removes_and_ends_the_service()
	{
		var reg = NewRegistry(out var timer, out _);
		var service = new FakeService(gameOver: false);
		reg.RegisterService("g1", service);

		var removed = await reg.TearDownGameAsync("g1");

		Assert.Same(service, removed);
		Assert.False(reg.HasService("g1"));
		Assert.True(service.Ended);
		Assert.Contains("g1", timer.Stopped);
		Assert.Null(await reg.TearDownGameAsync("g1")); // idempotent: nothing left
	}

	// ── Fakes ────────────────────────────────────────────────────────────────

	private sealed class RecordingTimer : IAuctionTimerService
	{
		public List<string> Stopped { get; } = new();
		public void StartTimers(string gameId, GameSettings settings, AuctionState auction) { }
		public void StopTimers(string gameId) => Stopped.Add(gameId);
		public event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick { add { } remove { } }
		public event Func<string, Task>? OnBidTimeout { add { } remove { } }
	}

	private sealed class RecordingRepo : IGameRepository
	{
		public List<string> Deleted { get; } = new();
		public Task<bool> DeleteGameAsync(string gameId) { Deleted.Add(gameId); return Task.FromResult(true); }
		public Task<GameDocument?> LoadGameAsync(string gameId) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument?> GetByInviteCodeAsync(string inviteCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument> CreateGameAsync(GameDocument game) => Task.FromResult(game);
		public Task<GameDocument> UpdateGameAsync(GameDocument game) => Task.FromResult(game);
	}

	private sealed class FakeService : IGameService
	{
		private readonly GameState _state;
		public bool Ended { get; private set; }
		public FakeService(bool gameOver) => _state = new GameState { IsGameOver = gameOver };

		public GameState? GameState => _state;
		public Task<GameState> GetGameStateAsync() => Task.FromResult(_state);
		public Task EndGameAsync() { Ended = true; return Task.CompletedTask; }

		public GameSettings Settings => new();
		public string GameId => "g";
		public bool IsGameActive => true;
		public Task<ServerResponse> ExecuteCommandAsync(GameCommand command) => Task.FromResult<ServerResponse>(new ErrorResponse { Message = "", Code = "" });
		public Task NotifyStateChangedAsync() => Task.CompletedTask;
		public Task SetPlayerConnectedAsync(string playerId, bool connected) => Task.CompletedTask;
		public Task InitializeFromDefinitionAsync(List<Player> players, GameDefinition definition, string lang = "en", GameSettings? settings = null, bool raceTeams = false, Dictionary<string, System.Text.Json.JsonElement>? ruleValues = null, List<List<string>>? teams = null) => Task.CompletedTask;
		public void ConfigureSettings(GameSettings settings) { }
		public Task RestoreGameAsync(GameState savedState) => Task.CompletedTask;
		public void AttachPackageDefinition(GameDefinition definition) { }
		public event Func<GameState, Task>? OnGameStateChanged { add { } remove { } }
		public event Func<IReadOnlyList<AnnouncementDispatch>, Task>? OnGameEvents { add { } remove { } }
		public event Func<Square, Task>? OnSquareChanged { add { } remove { } }
		public event Func<CardDrawnNotification, Task>? OnCardDrawn { add { } remove { } }
	}

	private sealed class NoopHubContext : IHubContext<GameHub>
	{
		public IHubClients Clients { get; } = new NoopClients();
		public IGroupManager Groups { get; } = new NoopGroups();

		private sealed class NoopClients : IHubClients
		{
			private static readonly IClientProxy Proxy = new NoopProxy();
			ISingleClientProxy IHubClients.Client(string connectionId) => (ISingleClientProxy)Proxy;
			IClientProxy IHubClients<IClientProxy>.All => Proxy;
			IClientProxy IHubClients<IClientProxy>.AllExcept(IReadOnlyList<string> e) => Proxy;
			IClientProxy IHubClients<IClientProxy>.Client(string c) => Proxy;
			IClientProxy IHubClients<IClientProxy>.Clients(IReadOnlyList<string> c) => Proxy;
			IClientProxy IHubClients<IClientProxy>.Group(string g) => Proxy;
			IClientProxy IHubClients<IClientProxy>.GroupExcept(string g, IReadOnlyList<string> e) => Proxy;
			IClientProxy IHubClients<IClientProxy>.Groups(IReadOnlyList<string> g) => Proxy;
			IClientProxy IHubClients<IClientProxy>.User(string u) => Proxy;
			IClientProxy IHubClients<IClientProxy>.Users(IReadOnlyList<string> u) => Proxy;
		}
		private sealed class NoopProxy : ISingleClientProxy
		{
			public Task SendCoreAsync(string method, object?[] args, CancellationToken ct = default) => Task.CompletedTask;
			public Task<T> InvokeCoreAsync<T>(string method, object?[] args, CancellationToken ct = default) => throw new NotImplementedException();
		}
		private sealed class NoopGroups : IGroupManager
		{
			public Task AddToGroupAsync(string c, string g, CancellationToken ct = default) => Task.CompletedTask;
			public Task RemoveFromGroupAsync(string c, string g, CancellationToken ct = default) => Task.CompletedTask;
		}
	}
}
