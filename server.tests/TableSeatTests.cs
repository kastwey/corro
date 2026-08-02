using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Sounds;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Giving up a seat, and what a table does about it (docs/tables.md).
///
/// Three goodbyes must stay distinct: DISCONNECTING keeps the seat, FORFEITING retires you from
/// the match but leaves you at the table, and LEAVING gives the seat up for good. This file is
/// about the third — the succession it triggers, the deletion when nobody is left, and what
/// happens when two people do it at the same instant.
/// </summary>
public class TableSeatTests
{
	private const string GameId = "g1";

	[Fact]
	public async Task Leaving_takes_the_seat_off_the_table()
	{
		var h = await BuildAsync(Human("host", "Ana", host: true), Human("b", "Berto"));

		await h.HubFor("b").LeaveTable();

		var table = await h.Repository.LoadGameAsync(GameId);
		Assert.Equal(new[] { "host" }, table!.Players.Select(p => p.Id));
		Assert.False(await h.Deleted());
	}

	[Fact]
	public async Task The_host_leaving_hands_the_sceptre_to_the_next_person_who_arrived()
	{
		// Arrival order IS the roster order, so "next" needs no timestamp: Berto sat down before
		// Carla, so the table is Berto's now.
		var h = await BuildAsync(
			Human("host", "Ana", host: true), Human("b", "Berto"), Human("c", "Carla"));

		await h.HubFor("host").LeaveTable();

		var table = await h.Repository.LoadGameAsync(GameId);
		Assert.Equal("b", table!.HostId);
		Assert.True(table.Players.Single(p => p.Id == "b").IsHost);
		Assert.False(table.Players.Single(p => p.Id == "c").IsHost);
	}

	[Fact]
	public async Task The_sceptre_never_goes_to_a_bot()
	{
		// A bot cannot invite anyone, start anything or answer for the table.
		var h = await BuildAsync(Human("host", "Ana", host: true), Bot("bot", "Crupier"), Human("c", "Carla"));

		await h.HubFor("host").LeaveTable();

		var table = await h.Repository.LoadGameAsync(GameId);
		Assert.Equal("c", table!.HostId);
	}

	[Fact]
	public async Task Being_disconnected_does_not_cost_you_your_place_in_the_queue()
	{
		// A player who is merely away still holds their seat, so they still inherit the table.
		// Skipping them would hand it to somebody who arrived later purely because of a dropout.
		var h = await BuildAsync(Human("host", "Ana", host: true), Human("b", "Berto"), Human("c", "Carla"));
		h.Registry.AuthenticateConnection("conn-c", "c");
		h.Registry.MapConnectionToGame("conn-c", GameId); // only Carla is connected

		await h.HubFor("host").LeaveTable();

		var table = await h.Repository.LoadGameAsync(GameId);
		Assert.Equal("b", table!.HostId);
	}

	[Fact]
	public async Task The_last_person_leaving_takes_the_table_with_them()
	{
		var h = await BuildAsync(Human("host", "Ana", host: true));

		await h.HubFor("host").LeaveTable();

		Assert.True(await h.Deleted());
	}

	[Fact]
	public async Task A_table_of_bots_is_not_a_table()
	{
		// The bots' seats go with it: nobody could ever start a game there again.
		var h = await BuildAsync(Human("host", "Ana", host: true), Bot("bot", "Crupier"));

		await h.HubFor("host").LeaveTable();

		Assert.True(await h.Deleted());
	}

	[Fact]
	public async Task Leaving_mid_match_forfeits_first_through_the_ordinary_command_path()
	{
		// Not a seat quietly vanishing from under the rulebook: the same command a player who
		// forfeits by hand sends, so the turn moves on and the family's retirement rules apply.
		var h = await BuildAsync(Human("host", "Ana", host: true), Human("b", "Berto"));
		var service = new RecordingService("b");
		h.Registry.RegisterService(GameId, service);

		await h.HubFor("b").LeaveTable();

		Assert.Contains(service.Commands, c => c is DeclareBankruptcyCommand);
		var table = await h.Repository.LoadGameAsync(GameId);
		Assert.DoesNotContain(table!.Players, p => p.Id == "b");
	}

	[Fact]
	public async Task A_player_already_out_of_the_match_does_not_forfeit_twice()
	{
		// They went bankrupt earlier and are now leaving the table: there is nothing left to give
		// up in the game, and re-running the command would announce a second retirement.
		var h = await BuildAsync(Human("host", "Ana", host: true), Human("b", "Berto"));
		var service = new RecordingService("b", bankrupt: true);
		h.Registry.RegisterService(GameId, service);

		await h.HubFor("b").LeaveTable();

		Assert.Empty(service.Commands);
	}

	[Fact]
	public async Task Leaving_twice_is_harmless()
	{
		// A double click, or a retry after a flaky connection.
		var h = await BuildAsync(Human("host", "Ana", host: true), Human("b", "Berto"));
		var hub = h.HubFor("b");

		await hub.LeaveTable();
		await hub.LeaveTable();

		var table = await h.Repository.LoadGameAsync(GameId);
		Assert.Equal(new[] { "host" }, table!.Players.Select(p => p.Id));
	}

	// ── Races ────────────────────────────────────────────────────────────────
	// Two people leaving at the same instant is the case a plain read-modify-write gets wrong:
	// each reads a table that still seats the other, and the second write puts the first one's
	// seat back. The per-game lock in MutateDocumentAsync is what these pin.

	[Fact]
	public async Task Two_players_leaving_at_once_both_lose_their_seats()
	{
		var h = await BuildAsync(
			Human("host", "Ana", host: true), Human("b", "Berto"), Human("c", "Carla"));

		await Task.WhenAll(h.HubFor("b").LeaveTable(), h.HubFor("c").LeaveTable());

		var table = await h.Repository.LoadGameAsync(GameId);
		Assert.Equal(new[] { "host" }, table!.Players.Select(p => p.Id));
		Assert.False(await h.Deleted(), "somebody is still sitting there");
	}

	[Fact]
	public async Task The_last_two_leaving_at_once_delete_the_table_exactly_once()
	{
		var h = await BuildAsync(Human("host", "Ana", host: true), Human("b", "Berto"));

		await Task.WhenAll(h.HubFor("host").LeaveTable(), h.HubFor("b").LeaveTable());

		Assert.True(await h.Deleted());
	}

	[Fact]
	public async Task Two_hosts_cannot_be_crowned_by_simultaneous_departures()
	{
		// The host and the next in line leave together. Whoever the succession lands on, the table
		// must end with exactly ONE host, and it must be somebody still sitting at it.
		var h = await BuildAsync(
			Human("host", "Ana", host: true), Human("b", "Berto"), Human("c", "Carla"), Human("d", "Dani"));

		await Task.WhenAll(h.HubFor("host").LeaveTable(), h.HubFor("b").LeaveTable());

		var table = await h.Repository.LoadGameAsync(GameId);
		Assert.Equal(new[] { "c", "d" }, table!.Players.Select(p => p.Id));
		Assert.Single(table.Players, p => p.IsHost);
		Assert.Contains(table.Players, p => p.Id == table.HostId && p.IsHost);
	}

	// ── Handing the sceptre over on purpose ──────────────────────────────────

	[Fact]
	public async Task The_host_can_hand_the_sceptre_over_without_leaving()
	{
		var h = await BuildAsync(Human("host", "Ana", host: true), Human("b", "Berto"));

		await h.HubFor("host").TransferHost("b");

		var table = await h.Repository.LoadGameAsync(GameId);
		Assert.Equal("b", table!.HostId);
		Assert.Single(table.Players, p => p.IsHost);
		Assert.Contains(table.Players, p => p.Id == "host"); // still seated
	}

	[Fact]
	public async Task Only_the_host_may_hand_the_sceptre_over()
	{
		var h = await BuildAsync(Human("host", "Ana", host: true), Human("b", "Berto"));

		await h.HubFor("b").TransferHost("b");

		Assert.Equal("host", (await h.Repository.LoadGameAsync(GameId))!.HostId);
	}

	[Fact]
	public async Task The_sceptre_cannot_be_handed_to_a_bot_or_to_a_stranger()
	{
		var h = await BuildAsync(Human("host", "Ana", host: true), Bot("bot", "Crupier"));

		await h.HubFor("host").TransferHost("bot");
		Assert.Equal("host", (await h.Repository.LoadGameAsync(GameId))!.HostId);

		await h.HubFor("host").TransferHost("nobody");
		Assert.Equal("host", (await h.Repository.LoadGameAsync(GameId))!.HostId);
	}

	// ── Harness ───────────────────────────────────────────────────────────────

	private static LobbyPlayer Human(string id, string name, bool host = false) => new()
	{
		Id = id,
		Name = name,
		Token = "disc",
		IsHost = host,
		PlayerSecretId = id + "-secret",
	};

	private static LobbyPlayer Bot(string id, string name) => new()
	{
		Id = id,
		Name = name,
		Token = "star",
		IsBot = true,
		PlayerSecretId = id + "-secret",
	};

	/// <summary>
	/// A repository that actually YIELDS around every read and write.
	///
	/// Without this the race tests have no teeth: the in-memory repository completes
	/// synchronously, so two "concurrent" calls run one after the other and would pass even with
	/// the lock removed. Yielding between the load and the save is what lets the second caller
	/// get in — which is exactly the window a read-modify-write has in production.
	/// </summary>
	private sealed class YieldingRepository : IGameRepository
	{
		private readonly InMemoryGameRepository _inner = new();

		public async Task<GameDocument?> LoadGameAsync(string gameId)
		{
			var game = await _inner.LoadGameAsync(gameId);
			await Task.Yield();
			return game;
		}

		public async Task<GameDocument> UpdateGameAsync(GameDocument game)
		{
			await Task.Yield();
			return await _inner.UpdateGameAsync(game);
		}

		public async Task<bool> DeleteGameAsync(string gameId)
		{
			await Task.Yield();
			return await _inner.DeleteGameAsync(gameId);
		}

		public Task<GameDocument> CreateGameAsync(GameDocument game) => _inner.CreateGameAsync(game);
		public Task<GameDocument?> GetByInviteCodeAsync(string inviteCode) => _inner.GetByInviteCodeAsync(inviteCode);
		public Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode) => _inner.GetByRejoinCodeAsync(rejoinCode);
		public IAsyncEnumerable<GameDocument> GetGamesLastUpdatedBeforeAsync(DateTime cutoffUtc, int maxCount, CancellationToken ct = default)
			=> _inner.GetGamesLastUpdatedBeforeAsync(cutoffUtc, maxCount, ct);
		public Task<bool> HasPackageReferenceAsync(string? packageToken, string? packageBlobKey, CancellationToken ct = default)
			=> _inner.HasPackageReferenceAsync(packageToken, packageBlobKey, ct);
		public Task<IReadOnlySet<string>> GetReferencedPackageBlobKeysAsync(CancellationToken ct = default)
			=> _inner.GetReferencedPackageBlobKeysAsync(ct);
	}

	private sealed class Harness
	{
		public required YieldingRepository Repository { get; init; }
		public required GameSessionRegistry Registry { get; init; }

		/// <summary>A hub whose connection is authenticated as this player at the table.</summary>
		public GameHub HubFor(string playerId)
		{
			var connectionId = "conn-" + playerId;
			Registry.MapConnectionToGame(connectionId, GameId);
			Registry.AuthenticateConnection(connectionId, playerId);
			return new GameHub(
				Repository,
				gameServiceFactory: null!,
				new NoopAuctionTimer(),
				new CorroPackageStore(new CompositeSoundPackProvider(new DefaultSoundPackProvider())),
				TestFixtures.NewPackageRestorer(),
				Registry,
				NullLogger<GameHub>.Instance)
			{
				Clients = new NoopHubCallerClients(),
				Context = new FakeCallerContext(connectionId),
				Groups = new NoopGroupManager(),
			};
		}

		public async Task<bool> Deleted() => await Repository.LoadGameAsync(GameId) is null;
	}

	private static async Task<Harness> BuildAsync(params LobbyPlayer[] players)
	{
		var repository = new YieldingRepository();
		await repository.CreateGameAsync(new GameDocument
		{
			Id = "game-" + GameId,
			GameId = GameId,
			Status = GameStatus.WaitingForPlayers,
			HostId = players.First(p => p.IsHost).Id,
			InviteCode = "INVITE",
			Players = players.ToList(),
		});
		var registry = new GameSessionRegistry(
			new NoopHubContext(), repository, new NoopAuctionTimer(), TestFixtures.NewPackageRestorer());
		return new Harness { Repository = repository, Registry = registry };
	}

	/// <summary>A game service that records the commands it is asked to run.</summary>
	private sealed class RecordingService : IGameService
	{
		private readonly GameState _state;
		public List<GameCommand> Commands { get; } = new();

		public RecordingService(string playerId, bool bankrupt = false)
			=> _state = new GameState
			{
				Players = new()
				{
					new Player { Id = "host", Name = "Ana", Token = "disc" },
					new Player { Id = playerId, Name = "Berto", Token = "star", IsBankrupt = bankrupt },
				},
			};

		public GameState? GameState => _state;
		public Task<GameState> GetGameStateAsync() => Task.FromResult(_state);
		public Task<ServerResponse> ExecuteCommandAsync(GameCommand command)
		{
			Commands.Add(command);
			return Task.FromResult<ServerResponse>(new ErrorResponse { Message = "", Code = "" });
		}

		public GameSettings Settings => new();
		public string GameId => TableSeatTests.GameId;
		public bool IsGameActive => true;
		public Task EndGameAsync() => Task.CompletedTask;
		public Task NotifyStateChangedAsync() => Task.CompletedTask;
		public Task SetPlayerConnectedAsync(string playerId, bool connected) => Task.CompletedTask;
		public Task InitializeFromDefinitionAsync(List<Player> players, CorroServer.Models.Corro.GameDefinition definition, string lang = "en", GameSettings? settings = null, bool raceTeams = false, Dictionary<string, System.Text.Json.JsonElement>? ruleValues = null, List<List<string>>? teams = null) => Task.CompletedTask;
		public void ConfigureSettings(GameSettings settings) { }
		public Task RestoreGameAsync(GameState savedState) => Task.CompletedTask;
		public void AttachPackageDefinition(CorroServer.Models.Corro.GameDefinition definition) { }
		public event Func<GameState, Task>? OnGameStateChanged { add { } remove { } }
		public event Func<IReadOnlyList<AnnouncementDispatch>, Task>? OnGameEvents { add { } remove { } }
		public event Func<Square, Task>? OnSquareChanged { add { } remove { } }
		public event Func<CardDrawnNotification, Task>? OnCardDrawn { add { } remove { } }
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
		IClientProxy IHubClients<IClientProxy>.AllExcept(IReadOnlyList<string> e) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Client(string c) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Clients(IReadOnlyList<string> c) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Group(string g) => _proxy;
		IClientProxy IHubClients<IClientProxy>.GroupExcept(string g, IReadOnlyList<string> e) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Groups(IReadOnlyList<string> g) => _proxy;
		IClientProxy IHubClients<IClientProxy>.User(string u) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Users(IReadOnlyList<string> u) => _proxy;
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
		IClientProxy IHubClients<IClientProxy>.AllExcept(IReadOnlyList<string> e) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Client(string c) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Clients(IReadOnlyList<string> c) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Group(string g) => _proxy;
		IClientProxy IHubClients<IClientProxy>.GroupExcept(string g, IReadOnlyList<string> e) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Groups(IReadOnlyList<string> g) => _proxy;
		IClientProxy IHubClients<IClientProxy>.User(string u) => _proxy;
		IClientProxy IHubClients<IClientProxy>.Users(IReadOnlyList<string> u) => _proxy;
	}

	private sealed class NoopGroupManager : IGroupManager
	{
		public Task AddToGroupAsync(string c, string g, CancellationToken ct = default) => Task.CompletedTask;
		public Task RemoveFromGroupAsync(string c, string g, CancellationToken ct = default) => Task.CompletedTask;
	}
}
