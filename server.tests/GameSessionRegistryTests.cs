using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using CorroServer.Services.Voice;
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
	public async Task CleanupIfGameOver_deletes_the_voice_room()
	{
		var voice = new RecordingVoiceService();
		var reg = new GameSessionRegistry(
			new NoopHubContext(),
			new RecordingRepo(),
			new RecordingTimer(),
			TestFixtures.NewPackageRestorer(),
			voiceService: voice);
		var service = new FakeService(gameOver: true);
		reg.RegisterService("g1", service);

		await reg.CleanupIfGameOverAsync("g1", service);

		Assert.Equal(new[] { "g1" }, voice.DeletedRooms);
	}

	[Fact]
	public async Task CleanupIfGameOver_deletes_the_uploaded_package_blob_recorded_by_the_game()
	{
		var blobKey = "blob-" + Guid.NewGuid().ToString("N");
		var blob = new CorroServer.Services.Corro.LocalFilePackageBlobStore(
			Path.Combine(Path.GetTempPath(), "corro_gameover_" + Guid.NewGuid().ToString("N")));
		await blob.PutAsync(blobKey, new MemoryStream(new byte[] { 1, 2, 3 }));
		var repo = new RecordingRepo();
		repo.Documents["g1"] = new GameDocument
		{
			Id = "game-g1",
			GameId = "g1",
			Status = GameStatus.Active,
			HostId = "host",
			InviteCode = "INV",
			PackageToken = "runtime-token",
			PackageBlobKey = blobKey,
		};
		var packageStore = new CorroServer.Services.Corro.CorroPackageStore(
			new CorroServer.Services.Sounds.CompositeSoundPackProvider(
				new CorroServer.Services.Sounds.DefaultSoundPackProvider()));
		var restorer = new CorroServer.Services.Corro.PackageRestorer(
			packageStore,
			new CorroServer.Services.Corro.ShippedPackageProvider(CorroTestPaths.PackagesRoot()),
			blob);
		var reg = new GameSessionRegistry(new NoopHubContext(), repo, new RecordingTimer(), restorer);
		var service = new FakeService(gameOver: true, packageToken: "runtime-token");
		reg.RegisterService("g1", service);

		await reg.CleanupIfGameOverAsync("g1", service);

		Assert.Null(await repo.LoadGameAsync("g1"));
		Assert.Null(await blob.GetAsync(blobKey));
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
		public Dictionary<string, GameDocument> Documents { get; } = new();
		public Task<bool> DeleteGameAsync(string gameId)
		{
			Deleted.Add(gameId);
			return Task.FromResult(Documents.Count == 0 || Documents.Remove(gameId));
		}
		public async IAsyncEnumerable<GameDocument> GetGamesLastUpdatedBeforeAsync(DateTime cutoffUtc, int maxCount, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
		{
			await Task.CompletedTask;
			yield break;
		}
		public Task<bool> HasPackageReferenceAsync(string? packageToken, string? packageBlobKey, CancellationToken ct = default)
			=> Task.FromResult(Documents.Values.Any(game =>
				(!string.IsNullOrEmpty(packageToken) && game.PackageToken == packageToken)
				|| (!string.IsNullOrEmpty(packageBlobKey) && game.PackageBlobKey == packageBlobKey)));
		public Task<IReadOnlySet<string>> GetReferencedPackageBlobKeysAsync(CancellationToken ct = default)
			=> Task.FromResult<IReadOnlySet<string>>(new HashSet<string>());
		public Task<GameDocument?> LoadGameAsync(string gameId)
			=> Task.FromResult(Documents.TryGetValue(gameId, out var game) ? game : null);
		public Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument?> GetByInviteCodeAsync(string inviteCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument> CreateGameAsync(GameDocument game) => Task.FromResult(game);
		public Task<GameDocument> UpdateGameAsync(GameDocument game) => Task.FromResult(game);
	}

	private sealed class RecordingVoiceService : ILiveKitVoiceService
	{
		public bool IsConfigured => true;
		public List<string> DeletedRooms { get; } = new();
		public VoiceJoinCredentials CreateJoinCredentials(string roomName, string participantId, string participantName)
			=> throw new NotSupportedException();
		public Task<bool> MuteParticipantAsync(string roomName, string participantId)
			=> throw new NotSupportedException();
		public Task DeleteRoomAsync(string roomName)
		{
			DeletedRooms.Add(roomName);
			return Task.CompletedTask;
		}
	}

	private sealed class FakeService : IGameService
	{
		private readonly GameState _state;
		public bool Ended { get; private set; }
		public FakeService(bool gameOver, string? packageToken = null)
			=> _state = new GameState { IsGameOver = gameOver, PackageToken = packageToken };

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
