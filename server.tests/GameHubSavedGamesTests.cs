using System.Reflection;
using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Sounds;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;

namespace CorroServer.Tests;

/// <summary>
/// Tests for the "saved games" lobby methods on <see cref="GameHub"/>:
/// <see cref="GameHub.GetGamesInfo"/> (resolve live info + who is connected, prune unknown)
/// and <see cref="GameHub.DeleteGameLobby"/> (host-only permanent deletion that disconnects
/// everyone). They drive the real Hub with hand-rolled SignalR fakes.
/// </summary>
// Live state lives in a per-test GameSessionRegistry (no shared static Hub state), so these
// tests are independent and need no serializing collection.
public class GameHubSavedGamesTests
{
	[Fact]
	public async Task DeleteGameLobby_AsHost_BroadcastsGameDeletedAndDeletesDocument()
	{
		var gameId = NewId();
		var game = DocFor(gameId, hostId: "host", hostSecret: "secret");
		var repo = new StubRepository(game);
		var (hub, clients, _) = BuildHub(repo);

		await hub.DeleteGameLobby(gameId, "host", "secret");

		Assert.True(clients.Group(gameId).Received("GameDeleted"));
		Assert.True(clients.Group($"lobby_{gameId}").Received("GameDeleted"));
		Assert.True(clients.Caller.Received("GameDeleted"));
		Assert.Contains(gameId, repo.Deleted);
	}

	[Fact]
	public async Task DeleteGameLobby_AsHost_DeletesItsUploadedPackageBlob()
	{
		var gameId = NewId();
		var packageToken = NewId();
		var blob = new LocalFilePackageBlobStore(
			Path.Combine(Path.GetTempPath(), "corro_hub_delete_" + NewId()));
		await blob.PutAsync(packageToken, new MemoryStream(new byte[] { 1, 2, 3 }));
		var game = DocFor(
			gameId,
			hostId: "host",
			hostSecret: "secret",
			packageToken: packageToken,
			packageBlobKey: packageToken);
		var repo = new StubRepository(game);
		var (hub, _, _) = BuildHub(repo, blob);

		await hub.DeleteGameLobby(gameId, "host", "secret");

		Assert.Null(await blob.GetAsync(packageToken));
	}

	[Fact]
	public async Task DeleteGameLobby_WrongHostId_RejectedWithHostOnly()
	{
		var gameId = NewId();
		var game = DocFor(gameId, hostId: "host", hostSecret: "secret");
		var repo = new StubRepository(game);
		var (hub, clients, _) = BuildHub(repo);

		await hub.DeleteGameLobby(gameId, "intruder", "secret");

		Assert.True(clients.Caller.Received("Error"));
		Assert.False(clients.Group(gameId).Received("GameDeleted"));
		Assert.DoesNotContain(gameId, repo.Deleted);
	}

	[Fact]
	public async Task DeleteGameLobby_WrongSecret_RejectedWithHostOnly()
	{
		var gameId = NewId();
		var game = DocFor(gameId, hostId: "host", hostSecret: "secret");
		var repo = new StubRepository(game);
		var (hub, clients, _) = BuildHub(repo);

		await hub.DeleteGameLobby(gameId, "host", "wrong-secret");

		Assert.True(clients.Caller.Received("Error"));
		Assert.False(clients.Group(gameId).Received("GameDeleted"));
		Assert.DoesNotContain(gameId, repo.Deleted);
	}

	[Fact]
	public async Task DeleteGameLobby_MissingGame_ConfirmsToCallerSoListPrunes()
	{
		var gameId = NewId();
		var repo = new StubRepository(); // no games — LoadGameAsync returns null
		var (hub, clients, _) = BuildHub(repo);

		await hub.DeleteGameLobby(gameId, "host", "secret");

		// The caller is told the game is gone (so the client prunes it)...
		Assert.True(clients.Caller.Received("GameDeleted"));
		// ...but nothing was actually deleted (there was nothing to delete).
		Assert.Empty(repo.Deleted);
	}

	[Fact]
	public async Task GetGamesInfo_ReturnsInfo_FlagsConnected_AndPrunesUnknown()
	{
		var gameId = NewId();
		var game = DocFor(gameId, hostId: "host", hostSecret: "secret", extraPlayerId: "guest");
		var repo = new StubRepository(game);
		var (hub, _, registry) = BuildHub(repo);

		// Mark "guest" as currently connected to this game.
		var connId = NewId();
		registry.AuthenticateConnection(connId, "guest");
		registry.MapConnectionToGame(connId, gameId);

		var result = await hub.GetGamesInfo(new List<string> { gameId, NewId() /* unknown */ });

		Assert.Single(result);
		var info = result[0];
		Assert.Equal(gameId, info.GameId);
		Assert.Equal(GameStatus.Active, info.Status);
		Assert.Equal(new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc), info.CreatedAt);
		Assert.Equal(2, info.Players.Count);

		var host = info.Players.Single(p => p.Id == "host");
		var guest = info.Players.Single(p => p.Id == "guest");
		Assert.True(host.IsHost);
		Assert.False(host.Connected);
		Assert.True(guest.Connected);
	}

	[Fact]
	public async Task GetGamesInfo_EmptyInput_ReturnsEmpty()
	{
		var repo = new StubRepository();
		var (hub, _, _) = BuildHub(repo);

		var result = await hub.GetGamesInfo(new List<string>());

		Assert.Empty(result);
	}

	[Fact]
	public async Task GetGameByInviteCode_KnownCode_ReturnsGameInfo()
	{
		var gameId = NewId();
		var game = DocFor(gameId, hostId: "host", hostSecret: "secret"); // InviteCode = "INV"
		var (hub, _, _) = BuildHub(new StubRepository(game));

		var result = await hub.GetGameByInviteCode("INV");

		// The Hub returns an anonymous object; assert via reflection on the shape.
		var gameIdValue = result.GetType().GetProperty("gameId")!.GetValue(result);
		Assert.Equal(gameId, gameIdValue);
		// A built-in board carries no package, so no token override (the client uses the 8 defaults).
		Assert.Null(result.GetType().GetProperty("tokens")!.GetValue(result));
	}

	[Fact]
	public async Task GetGameByInviteCode_PackageGame_ReturnsTheBoardsOwnTokens()
	{
		// Regression: a joiner used to see the built-in pieces because the invite info omitted the
		// package. The hub now resolves the board's tokens (re-staging the shipped board from disk
		// when it isn't already staged on this instance) so the lobby selector shows them.
		var gameId = NewId();
		var game = DocFor(gameId, hostId: "host", hostSecret: "secret",
					 packageToken: NewId(), shippedBoardId: "galactic-empire");
		var (hub, _, _) = BuildHub(new StubRepository(game));

		var result = await hub.GetGameByInviteCode("INV");

		var tokens = (List<TokenDef>?)result.GetType().GetProperty("tokens")!.GetValue(result);
		Assert.NotNull(tokens);
		Assert.Equal(new[] { "ufo", "rocket", "alien", "star" }, tokens!.Select(tk => tk.Id));
	}

	[Fact]
	public async Task GetGameByInviteCode_UnknownCode_ThrowsGameNotFound_NotLookupError()
	{
		// A missing game (expired/invalid code) must surface a clean GAME_NOT_FOUND so the
		// client can react, NOT the generic GAME_LOOKUP_ERROR (regression: the not-found
		// HubException used to be swallowed by the catch-all and remapped).
		var (hub, _, _) = BuildHub(new StubRepository());

		var ex = await Assert.ThrowsAsync<HubException>(() => hub.GetGameByInviteCode("NOPE12"));

		Assert.Equal("GAME_NOT_FOUND", ex.Message);
	}

	[Fact]
	public async Task GetGameByInviteCode_RepositoryFailure_ThrowsGameLookupError()
	{
		var repo = new StubRepository { ThrowOnInviteLookup = true };
		var (hub, _, _) = BuildHub(repo);

		var ex = await Assert.ThrowsAsync<HubException>(() => hub.GetGameByInviteCode("INV"));

		Assert.Equal("GAME_LOOKUP_ERROR", ex.Message);
	}

	// ── Harness ──────────────────────────────────────────────────────────────

	private static string NewId() => Guid.NewGuid().ToString("N");

	// ── An account's tables ──────────────────────────────────────────────────
	//
	// GetGamesInfo answers "tell me about the tables THIS BROWSER remembers"; GetMyTables answers
	// "tell me about the tables I HAVE A SEAT AT". The second is what makes a table belong to a
	// person: it survives a cleared browser and follows them to a device that has never seen them.

	[Fact]
	public async Task GetMyTables_ListsTheTablesTheAccountHoldsASeatAt()
	{
		var mine = DocFor(NewId(), hostId: "host", hostSecret: "s", userId: "user-1");
		var someoneElses = DocFor(NewId(), hostId: "other", hostSecret: "s", userId: "user-2");
		var anonymous = DocFor(NewId(), hostId: "nobody", hostSecret: "s");
		var repo = new StubRepository(mine, someoneElses, anonymous);
		var (hub, _, _) = BuildHub(repo, signedInUserId: "user-1");

		var tables = await hub.GetMyTables();

		var listed = Assert.Single(tables);
		Assert.Equal(mine.GameId, listed.GameId);
	}

	[Fact]
	public async Task GetMyTables_IsEmptyForAnAnonymousCaller()
	{
		// Not signing in is a normal state, not a failure: the answer is "nothing extra", and the
		// browser's own list carries on working exactly as it did.
		var repo = new StubRepository(DocFor(NewId(), hostId: "host", hostSecret: "s", userId: "user-1"));
		var (hub, _, _) = BuildHub(repo);

		Assert.Empty(await hub.GetMyTables());
	}

	[Fact]
	public async Task GetMyTables_DescribesATableExactlyAsTheSavedGamesListDoes()
	{
		// Both doors share one projection, so a table cannot describe itself one way to a browser
		// and another way to an account.
		var game = DocFor(NewId(), hostId: "host", hostSecret: "s", extraPlayerId: "guest", userId: "user-1");
		var repo = new StubRepository(game);
		var (hub, _, _) = BuildHub(repo, signedInUserId: "user-1");

		var byAccount = Assert.Single(await hub.GetMyTables());
		var byId = Assert.Single(await hub.GetGamesInfo(new List<string> { game.GameId }));

		Assert.Equal(byId.GameId, byAccount.GameId);
		Assert.Equal(byId.Status, byAccount.Status);
		Assert.Equal(byId.HostId, byAccount.HostId);
		Assert.Equal(
			byId.Players.Select(p => (p.Id, p.Name, p.IsHost, p.Connected)),
			byAccount.Players.Select(p => (p.Id, p.Name, p.IsHost, p.Connected)));
	}

	// ── Adopting the seats a browser holds ──────────────────────────────────
	//
	// Somebody who played for months before signing in has all of it in one browser. Signing in
	// should not mean starting again on the next device — but the seat's own secret is what makes
	// that safe, and these are mostly about what CANNOT be adopted.

	[Fact]
	public async Task AdoptSeats_TakesASeatTheBrowserCanProve()
	{
		var gameId = NewId();
		var repo = new StubRepository(DocFor(gameId, hostId: "host", hostSecret: "secret"));
		var (hub, _, _) = BuildHub(repo, signedInUserId: "user-1");

		var adopted = await hub.AdoptSeats(new List<SeatAdoption>
		{
			new() { GameId = gameId, PlayerId = "host", PlayerSecretId = "secret" },
		});

		Assert.Equal(1, adopted);
		Assert.Equal("user-1", (await repo.LoadGameAsync(gameId))!.Players.Single(p => p.Id == "host").UserId);
	}

	[Fact]
	public async Task AdoptSeats_RefusesASeatWithoutItsSecret()
	{
		// The secret IS the proof. Without it this would be "name a game id, take a seat".
		var gameId = NewId();
		var repo = new StubRepository(DocFor(gameId, hostId: "host", hostSecret: "secret"));
		var (hub, _, _) = BuildHub(repo, signedInUserId: "user-1");

		var adopted = await hub.AdoptSeats(new List<SeatAdoption>
		{
			new() { GameId = gameId, PlayerId = "host", PlayerSecretId = "wrong" },
		});

		Assert.Equal(0, adopted);
		Assert.Null((await repo.LoadGameAsync(gameId))!.Players.Single(p => p.Id == "host").UserId);
	}

	[Fact]
	public async Task AdoptSeats_NeverTakesASeatAnotherAccountAlreadyOwns()
	{
		// Even holding the secret. Moving a seat between accounts is the takeover this design
		// refuses everywhere else, and a shared browser is exactly where it would happen.
		var gameId = NewId();
		var repo = new StubRepository(DocFor(gameId, hostId: "host", hostSecret: "secret", userId: "user-2"));
		var (hub, _, _) = BuildHub(repo, signedInUserId: "user-1");

		var adopted = await hub.AdoptSeats(new List<SeatAdoption>
		{
			new() { GameId = gameId, PlayerId = "host", PlayerSecretId = "secret" },
		});

		Assert.Equal(0, adopted);
		Assert.Equal("user-2", (await repo.LoadGameAsync(gameId))!.Players.Single(p => p.Id == "host").UserId);
	}

	[Fact]
	public async Task AdoptSeats_DoesNothingForAnAnonymousCaller()
	{
		var gameId = NewId();
		var repo = new StubRepository(DocFor(gameId, hostId: "host", hostSecret: "secret"));
		var (hub, _, _) = BuildHub(repo);

		Assert.Equal(0, await hub.AdoptSeats(new List<SeatAdoption>
		{
			new() { GameId = gameId, PlayerId = "host", PlayerSecretId = "secret" },
		}));
	}

	[Fact]
	public async Task AdoptSeats_TakesTheOnesItCanAndSkipsTheRest()
	{
		// One good, one unprovable, one belonging to somebody else, one that no longer exists. A
		// single bad entry must not cost the player the others.
		var mine = NewId();
		var theirs = NewId();
		var wrongSecret = NewId();
		var repo = new StubRepository(
			DocFor(mine, hostId: "host", hostSecret: "secret"),
			DocFor(theirs, hostId: "host", hostSecret: "secret", userId: "user-2"),
			DocFor(wrongSecret, hostId: "host", hostSecret: "secret"));
		var (hub, _, _) = BuildHub(repo, signedInUserId: "user-1");

		var adopted = await hub.AdoptSeats(new List<SeatAdoption>
		{
			new() { GameId = mine, PlayerId = "host", PlayerSecretId = "secret" },
			new() { GameId = theirs, PlayerId = "host", PlayerSecretId = "secret" },
			new() { GameId = wrongSecret, PlayerId = "host", PlayerSecretId = "nope" },
			new() { GameId = NewId(), PlayerId = "host", PlayerSecretId = "secret" },
		});

		Assert.Equal(1, adopted);
	}

	[Fact]
	public async Task AdoptSeats_IsHarmlessToRepeat()
	{
		// It runs whenever the lobby loads, so the second time must simply find nothing new: a
		// seat this account already owns is not adopted again.
		var gameId = NewId();
		var repo = new StubRepository(DocFor(gameId, hostId: "host", hostSecret: "secret"));
		var (hub, _, _) = BuildHub(repo, signedInUserId: "user-1");
		var seats = new List<SeatAdoption>
		{
			new() { GameId = gameId, PlayerId = "host", PlayerSecretId = "secret" },
		};

		Assert.Equal(1, await hub.AdoptSeats(seats));
		Assert.Equal(0, await hub.AdoptSeats(seats));
		Assert.Equal("user-1", (await repo.LoadGameAsync(gameId))!.Players.Single(p => p.Id == "host").UserId);
	}

	private static GameDocument DocFor(string gameId, string hostId, string hostSecret, string? extraPlayerId = null,
		string? packageToken = null, string? shippedBoardId = null, string? packageBlobKey = null,
		string? userId = null)
	{
		var players = new List<LobbyPlayer>
		{
			new()
			{
				Id = hostId, Name = "Host", Token = "disc", IsHost = true, PlayerSecretId = hostSecret,
				UserId = userId,
			}
		};
		if (extraPlayerId != null)
		{
			players.Add(new LobbyPlayer
			{
				Id = extraPlayerId,
				Name = "Guest",
				Token = "cross",
				IsHost = false,
				PlayerSecretId = "guest-secret"
			});
		}

		return new GameDocument
		{
			Id = gameId,
			GameId = gameId,
			Status = GameStatus.Active,
			HostId = hostId,
			InviteCode = "INV",
					 Board = "galactic-empire",
			PackageToken = packageToken,
			ShippedBoardId = shippedBoardId,
			PackageBlobKey = packageBlobKey,
			MaxPlayers = 4,
			CreatedAt = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc),
			Players = players
		};
	}

	private static (GameHub hub, FakeClients clients, GameSessionRegistry registry) BuildHub(
		StubRepository repo,
		IPackageBlobStore? blob = null,
		string? signedInUserId = null)
	{
		var packageStore = new CorroPackageStore(new CompositeSoundPackProvider(new DefaultSoundPackProvider()));
		var restorer = blob is null
			? TestFixtures.NewPackageRestorer()
			: new PackageRestorer(packageStore, new ShippedPackageProvider(CorroTestPaths.PackagesRoot()), blob);
		var registry = new GameSessionRegistry(new FakeHubContext(), repo, new FakeAuctionTimer(), restorer);
		var hub = new GameHub(
			repo,
			new FakeGameServiceFactory(),
			new FakeAuctionTimer(),
			packageStore,
			restorer,
			registry,
			NullLogger<GameHub>.Instance);

		var clients = new FakeClients();
		hub.Clients = clients;
		hub.Groups = new FakeGroupManager();
		hub.Context = new FakeCallerContext(
			"c-" + NewId(),
			signedInUserId is null ? null : CorroServer.Services.Accounts.SessionPrincipal.For(signedInUserId));
		return (hub, clients, registry);
	}

	// ── Repository stub ──────────────────────────────────────────────────────

	private sealed class StubRepository : IGameRepository
	{
	/// <summary>Nothing invites anybody in this stub; the tests that care use their own.</summary>
	public Task<IReadOnlyList<GameDocument>> GetTablesInvitingUserAsync(
		string userId, int maxCount, CancellationToken ct = default) =>
		Task.FromResult<IReadOnlyList<GameDocument>>(Array.Empty<GameDocument>());

		private readonly Dictionary<string, GameDocument> _games;
		public List<string> Deleted { get; } = new();

		/// <summary>When true, <see cref="GetByInviteCodeAsync"/> throws to simulate a backend failure.</summary>
		public bool ThrowOnInviteLookup { get; set; }

		public StubRepository(params GameDocument[] games)
			=> _games = games.ToDictionary(g => g.GameId);

		public Task<GameDocument?> LoadGameAsync(string gameId)
			=> Task.FromResult(_games.TryGetValue(gameId, out var g) ? g : null);

		public Task<bool> DeleteGameAsync(string gameId)
		{
			Deleted.Add(gameId);
			_games.Remove(gameId);
			return Task.FromResult(true);
		}

		public async IAsyncEnumerable<GameDocument> GetGamesLastUpdatedBeforeAsync(DateTime cutoffUtc, int maxCount, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
		{
			foreach (var game in _games.Values.Where(game => game.LastUpdated < cutoffUtc).Take(maxCount).ToList())
			{
				ct.ThrowIfCancellationRequested();
				yield return game;
				await Task.Yield();
			}
		}

		public Task<bool> HasPackageReferenceAsync(string? packageToken, string? packageBlobKey, CancellationToken ct = default)
			=> Task.FromResult(_games.Values.Any(game =>
				(!string.IsNullOrEmpty(packageToken) && game.PackageToken == packageToken)
				|| (!string.IsNullOrEmpty(packageBlobKey) && game.PackageBlobKey == packageBlobKey)));

		public Task<IReadOnlySet<string>> GetReferencedPackageBlobKeysAsync(CancellationToken ct = default)
			=> Task.FromResult<IReadOnlySet<string>>(_games.Values
				.Select(game => game.PackageBlobKey)
				.Where(key => !string.IsNullOrEmpty(key))
				.Cast<string>()
				.ToHashSet());

		public Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode) => Task.FromResult<GameDocument?>(null);
		/// <summary>The real filter, because THIS file is where the account's list is tested: a
		/// stub that always answered "nothing" would make those tests pass for the wrong reason.</summary>
		public Task<IReadOnlyList<GameDocument>> GetGamesForUserAsync(string userId, int maxCount, CancellationToken ct = default)
			=> Task.FromResult<IReadOnlyList<GameDocument>>(_games.Values
				.Where(g => g.Players.Any(p => p.UserId == userId))
				.OrderByDescending(g => g.LastUpdated)
				.Take(maxCount)
				.ToList());

		public Task<int> ReassignSeatsAsync(string fromUserId, string toUserId, CancellationToken ct = default)
			=> Task.FromResult(0);

		public Task<GameDocument?> GetByInviteCodeAsync(string inviteCode)
		{
			if (ThrowOnInviteLookup)
			{
				throw new InvalidOperationException("simulated repository failure");
			}

			return Task.FromResult<GameDocument?>(
				_games.Values.FirstOrDefault(g => g.InviteCode == inviteCode));
		}
		public Task<GameDocument> CreateGameAsync(GameDocument game) => Task.FromResult(game);
		/// <summary>Stores it, rather than handing it back and forgetting. A repository stub that
		/// silently discards writes makes every test that checks what was SAVED pass for the wrong
		/// reason — or fail for one, which is how this was found.</summary>
		public Task<GameDocument> UpdateGameAsync(GameDocument game)
		{
			_games[game.GameId] = game;
			return Task.FromResult(game);
		}
	}

	// ── SignalR fakes ────────────────────────────────────────────────────────

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

	private sealed class FakeClients : IHubCallerClients
	{
		private readonly RecordingProxy _caller = new();
		private readonly Dictionary<string, RecordingProxy> _groups = new();
		private readonly RecordingProxy _shared = new();

		public RecordingProxy Caller => _caller;

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
		public FakeCallerContext(string connectionId, System.Security.Claims.ClaimsPrincipal? user = null)
		{
			ConnectionId = connectionId;
			User = user;
		}
		public override string ConnectionId { get; }
		public override string? UserIdentifier => null;
		/// <summary>The session the handshake established, or null for the anonymous player —
		/// which is what almost every connection is.</summary>
		public override System.Security.Claims.ClaimsPrincipal? User { get; }
		public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
		public override Microsoft.AspNetCore.Http.Features.IFeatureCollection Features { get; }
			= new Microsoft.AspNetCore.Http.Features.FeatureCollection();
		public override CancellationToken ConnectionAborted => CancellationToken.None;
		public override void Abort() { }
	}

	private sealed class FakeGroupManager : IGroupManager
	{
		public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) => Task.CompletedTask;
		public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) => Task.CompletedTask;
	}

	private sealed class FakeHubContext : IHubContext<GameHub>
	{
		private readonly FakeHubClients _clients = new();
		public IHubClients Clients => _clients;
		public IGroupManager Groups { get; } = new FakeGroupManager();
	}

	private sealed class FakeHubClients : IHubClients
	{
		private readonly RecordingProxy _proxy = new();
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

	private sealed class FakeGameServiceFactory : IGameServiceFactory
	{
		public IGameService Create(string? gameId = null) => throw new NotImplementedException();
	}

	private sealed class FakeAuctionTimer : IAuctionTimerService
	{
		public void StartTimers(string gameId, GameSettings settings, AuctionState auction) { }
		public void StopTimers(string gameId) { }
		public event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick { add { } remove { } }
		public event Func<string, Task>? OnBidTimeout { add { } remove { } }
	}
}
