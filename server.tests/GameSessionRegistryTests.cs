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

	/// <summary>The same registry, for a suite that only needs the connection bookkeeping and has
	/// nothing to assert about the collaborators (see <see cref="PublicMetricsTests"/>).</summary>
	internal static GameSessionRegistry NewStubRegistry() => NewRegistry(out _, out _);

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
	public void Remapping_a_connection_replaces_its_stale_game_player_and_lobby()
	{
		var reg = NewRegistry(out _, out _);
		reg.MapConnectionToGame("c1", "g1");
		reg.AuthenticateConnection("c1", "a");
		reg.MapLobbyConnection("c1", "g1");

		reg.MapConnectionToGame("c1", "g2");
		reg.AuthenticateConnection("c1", "b");
		reg.MapLobbyConnection("c1", "g2");

		Assert.True(reg.IsAuthenticated("c1", out var playerId, out var gameId));
		Assert.Equal("b", playerId);
		Assert.Equal("g2", gameId);
		Assert.DoesNotContain("c1", reg.LobbyConnectionIds("g1"));
		Assert.Contains("c1", reg.LobbyConnectionIds("g2"));
	}

	// A finished match ends the GAME, not the group that played it. What used to be one deletion is
	// now a retirement: the clocks and the in-memory service go, the table stays, and the final
	// snapshot moves to LastMatch so the result outlives the game that produced it.
	[Fact]
	public async Task CleanupIfGameOver_retires_the_match_and_leaves_the_table_standing()
	{
		var reg = NewRegistry(out var timer, out var repo);
		repo.Documents["g1"] = NewTable("g1");
		var service = new FakeService(gameOver: true);
		reg.RegisterService("g1", service);

		await reg.CleanupIfGameOverAsync("g1", service);

		Assert.False(reg.HasService("g1"));          // the match is out of memory
		Assert.True(service.Ended);                   // EndGameAsync called
		Assert.Contains("g1", timer.Stopped);         // its clocks stopped
		Assert.Empty(repo.Deleted);                   // …and nothing was deleted

		var table = await repo.LoadGameAsync("g1");
		Assert.Equal(GameStatus.WaitingForPlayers, table!.Status);  // back at the table
		Assert.Null(table.GameState);                                // no match running
		Assert.True(table.LastMatch!.IsGameOver);                    // but the result is kept
		Assert.Equal(1, table.MatchesPlayed);
	}

	[Fact]
	public async Task CleanupIfGameOver_tells_the_table_the_match_ended()
	{
		// Whoever was not looking at the board — sitting in the table view, or reading the chat —
		// learns it from the broadcast rather than from a state that simply stops arriving.
		var hub = new NoopHubContext();
		var repo = new RecordingRepo();
		repo.Documents["g1"] = NewTable("g1");
		var reg = new GameSessionRegistry(hub, repo, new RecordingTimer(), TestFixtures.NewPackageRestorer());
		var service = new FakeService(gameOver: true);
		reg.RegisterService("g1", service);

		await reg.CleanupIfGameOverAsync("g1", service);

		Assert.Contains("MatchEnded", hub.Sent);
	}

	[Fact]
	public async Task CleanupIfGameOver_without_a_persisted_table_still_ends_the_match()
	{
		// An in-memory-only game (no document) has no table to keep; it must still not leak.
		var reg = NewRegistry(out var timer, out var repo);
		var service = new FakeService(gameOver: true);
		reg.RegisterService("g1", service);

		await reg.CleanupIfGameOverAsync("g1", service);

		Assert.False(reg.HasService("g1"));
		Assert.True(service.Ended);
		Assert.Contains("g1", timer.Stopped);
		Assert.Empty(repo.Deleted);
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
	public async Task CleanupIfGameOver_keeps_the_voice_room_because_it_belongs_to_the_table()
	{
		// The conversation is the table's. Tearing the room down between matches would cut everyone
		// off mid-sentence and make them rejoin to talk about the game they just finished.
		var voice = new RecordingVoiceService();
		var repo = new RecordingRepo();
		repo.Documents["g1"] = NewTable("g1");
		var reg = new GameSessionRegistry(
			new NoopHubContext(),
			repo,
			new RecordingTimer(),
			TestFixtures.NewPackageRestorer(),
			voiceService: voice);
		var service = new FakeService(gameOver: true);
		reg.RegisterService("g1", service);

		await reg.CleanupIfGameOverAsync("g1", service);

		Assert.Empty(voice.DeletedRooms);
	}

	[Fact]
	public async Task Deleting_the_table_deletes_its_voice_room()
	{
		// The room outlives matches, not the table itself.
		var voice = new RecordingVoiceService();
		var repo = new RecordingRepo();
		repo.Documents["g1"] = NewTable("g1");
		var reg = new GameSessionRegistry(
			new NoopHubContext(),
			repo,
			new RecordingTimer(),
			TestFixtures.NewPackageRestorer(),
			voiceService: voice);
		reg.RegisterService("g1", new FakeService(gameOver: true));

		await reg.DeleteGameAsync("g1");

		Assert.Equal(new[] { "g1" }, voice.DeletedRooms);
	}

	[Fact]
	public async Task Deleting_the_table_releases_the_uploaded_package_blob_it_recorded()
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

		await reg.DeleteGameAsync("g1");

		Assert.Null(await repo.LoadGameAsync("g1"));
		Assert.Null(await blob.GetAsync(blobKey));
	}

	[Fact]
	public async Task A_finished_match_keeps_the_uploaded_package_for_the_next_one()
	{
		// The board a table just played is the board it is most likely to play again. Releasing the
		// archive at game over would leave the table holding a reference to something that is gone.
		var blobKey = "blob-" + Guid.NewGuid().ToString("N");
		var blob = new CorroServer.Services.Corro.LocalFilePackageBlobStore(
			Path.Combine(Path.GetTempPath(), "corro_retire_" + Guid.NewGuid().ToString("N")));
		await blob.PutAsync(blobKey, new MemoryStream(new byte[] { 1, 2, 3 }));
		var repo = new RecordingRepo();
		repo.Documents["g1"] = NewTable("g1") with
		{
			PackageToken = "runtime-token",
			PackageBlobKey = blobKey,
		};
		var restorer = new CorroServer.Services.Corro.PackageRestorer(
			new CorroServer.Services.Corro.CorroPackageStore(
				new CorroServer.Services.Sounds.CompositeSoundPackProvider(
					new CorroServer.Services.Sounds.DefaultSoundPackProvider())),
			new CorroServer.Services.Corro.ShippedPackageProvider(CorroTestPaths.PackagesRoot()),
			blob);
		var reg = new GameSessionRegistry(new NoopHubContext(), repo, new RecordingTimer(), restorer);
		var service = new FakeService(gameOver: true, packageToken: "runtime-token");
		reg.RegisterService("g1", service);

		await reg.CleanupIfGameOverAsync("g1", service);

		var table = await repo.LoadGameAsync("g1");
		Assert.Equal(blobKey, table!.PackageBlobKey);
		Assert.NotNull(await blob.GetAsync(blobKey));
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

	/// <summary>A persisted table with no match running — what every game starts and ends as.</summary>
	private static GameDocument NewTable(string gameId) => new()
	{
		Id = "game-" + gameId,
		GameId = gameId,
		Status = GameStatus.Active,
		HostId = "host",
		InviteCode = "INV",
	};

	// The public liveness number in the footer. It counts PEOPLE PRESENT, which is a narrower
	// question than "does this process know about the game": a table everyone dropped out of is
	// exactly the one nobody is sitting at, and advertising it would make a quiet server look busy.
	[Fact]
	public void CountActiveTables_counts_tables_with_somebody_connected_once_each()
	{
		var reg = NewRegistry(out _, out _);
		Assert.Equal(0, reg.CountActiveTables());

		// Two players at one table, plus one at another: two tables, not three connections.
		reg.MapConnectionToGame("c1", "g1");
		reg.MapConnectionToGame("c2", "g1");
		reg.MapConnectionToGame("c3", "g2");
		Assert.Equal(2, reg.CountActiveTables());

		// Somebody waiting in a table's lobby is somebody at that table.
		reg.MapLobbyConnection("c4", "g3");
		Assert.Equal(3, reg.CountActiveTables());
		// …and the same table reached from both maps is still one table.
		reg.MapLobbyConnection("c5", "g1");
		Assert.Equal(3, reg.CountActiveTables());

		// They leave: the table stops counting the moment the last connection goes.
		reg.TryRemoveGameConnection("c1", out _);
		reg.TryRemoveGameConnection("c2", out _);
		Assert.Equal(3, reg.CountActiveTables()); // c5 is still in g1's lobby
		reg.TryRemoveLobbyConnection("c5", out _);
		Assert.Equal(2, reg.CountActiveTables());
	}

	// The companion number. Counted by PLAYER: somebody with the board open in two tabs is one
	// person, and a count that said otherwise would inflate every figure the footer shows.
	[Fact]
	public void CountConnectedPlayers_counts_people_not_connections()
	{
		var reg = NewRegistry(out _, out _);
		Assert.Equal(0, reg.CountConnectedPlayers());

		reg.AuthenticateConnection("c1", "a"); reg.MapConnectionToGame("c1", "g1");
		reg.AuthenticateConnection("c2", "a"); reg.MapConnectionToGame("c2", "g1"); // a's second tab
		reg.AuthenticateConnection("c3", "b"); reg.MapConnectionToGame("c3", "g1");
		reg.AuthenticateConnection("c4", "c"); reg.MapConnectionToGame("c4", "g2"); // another table
		Assert.Equal(3, reg.CountConnectedPlayers());

		// One of a's two tabs closes: a is still here.
		reg.ForgetGameConnection("c1");
		Assert.Equal(3, reg.CountConnectedPlayers());
		// The other one goes, and so does a. A liveness number that only ever grew would be
		// worse than none at all.
		reg.ForgetGameConnection("c2");
		Assert.Equal(2, reg.CountConnectedPlayers());
	}

	[Fact]
	public void CountActiveTables_ignores_a_game_this_process_merely_holds()
	{
		var reg = NewRegistry(out _, out _);
		reg.RegisterService("g1", new FakeService(gameOver: false));

		// The service is registered and HasActivity says so — but nobody is connected, which is
		// the whole difference between "a game exists" and "there are people playing".
		Assert.True(reg.HasActivity("g1"));
		Assert.Equal(0, reg.CountActiveTables());
	}

	// ── Fakes ────────────────────────────────────────────────────────────────

	internal sealed class RecordingTimer : IAuctionTimerService
	{
		public List<string> Stopped { get; } = new();
		public void StartTimers(string gameId, GameSettings settings, AuctionState auction) { }
		public void StopTimers(string gameId) => Stopped.Add(gameId);
		public event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick { add { } remove { } }
		public event Func<string, Task>? OnBidTimeout { add { } remove { } }
	}

	internal sealed class RecordingRepo : IGameRepository
	{
	/// <summary>Nothing invites anybody in this stub; the tests that care use their own.</summary>
	public Task<IReadOnlyList<GameDocument>> GetTablesInvitingUserAsync(
		string userId, int maxCount, CancellationToken ct = default) =>
		Task.FromResult<IReadOnlyList<GameDocument>>(Array.Empty<GameDocument>());

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
		public Task<IReadOnlyList<GameDocument>> GetGamesForUserAsync(string userId, int maxCount, CancellationToken ct = default)
			=> Task.FromResult<IReadOnlyList<GameDocument>>(Array.Empty<GameDocument>());
		public Task<int> ReassignSeatsAsync(string fromUserId, string toUserId, CancellationToken ct = default)
			=> Task.FromResult(0);
		public Task<GameDocument?> GetByInviteCodeAsync(string inviteCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument> CreateGameAsync(GameDocument game) => Task.FromResult(game);
		public Task<GameDocument> UpdateGameAsync(GameDocument game)
		{
			// Stored, so a test can read back what a write actually left behind.
			Documents[game.GameId] = game;
			return Task.FromResult(game);
		}
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
		public event Func<CardDrawnNotification, Task>? OnCardDrawn { add { } remove { } }
		public event Func<ServerResponse, Task>? OnBroadcast { add { } remove { } }
	}

	internal sealed class NoopHubContext : IHubContext<GameHub>
	{
		private readonly NoopClients _clients = new();
		public IHubClients Clients => _clients;
		public IGroupManager Groups { get; } = new NoopGroups();

		/// <summary>Every method name pushed to any client target, so a test can pin a broadcast.</summary>
		public IReadOnlyList<string> Sent => _clients.Proxy.Methods;

		private sealed class NoopClients : IHubClients
		{
			// Per-instance, so one test's broadcasts never leak into another's assertions.
			internal readonly RecordingProxy Proxy = new();
			ISingleClientProxy IHubClients.Client(string connectionId) => Proxy;
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
		private sealed class RecordingProxy : ISingleClientProxy
		{
			public List<string> Methods { get; } = new();
			public Task SendCoreAsync(string method, object?[] args, CancellationToken ct = default)
			{
				Methods.Add(method);
				return Task.CompletedTask;
			}
			public Task<T> InvokeCoreAsync<T>(string method, object?[] args, CancellationToken ct = default) => throw new NotImplementedException();
		}
		private sealed class NoopGroups : IGroupManager
		{
			public Task AddToGroupAsync(string c, string g, CancellationToken ct = default) => Task.CompletedTask;
			public Task RemoveFromGroupAsync(string c, string g, CancellationToken ct = default) => Task.CompletedTask;
		}
	}
}
