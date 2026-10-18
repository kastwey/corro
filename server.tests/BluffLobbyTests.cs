using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Corro;
using Microsoft.Extensions.Logging.Abstractions;

namespace CorroServer.Tests;
using CorroServer.Tests.Doubles;

/// <summary>
/// The two doors a hall walks through: a table with no seat count beyond the family's ceiling,
/// and a join that asks for a name and no piece. Both are the family's answers read by the lobby,
/// so a table of a turn-taking family keeps every rule it always had.
/// </summary>
public class BluffLobbyTests
{
	private sealed record Harness(GameHub Hub, CapturingCallerClients Clients, InMemoryGameRepository Repository);

	private static async Task<Harness> BuildAsync(params string[] packages)
	{
		var repository = new InMemoryGameRepository();
		var timer = new NoopAuctionTimer();
		var registry = new GameSessionRegistry(new NoopHubContext(), repository, timer, TestFixtures.NewPackageRestorer());
		var store = new CorroPackageStore(
			new CorroServer.Services.Sounds.CompositeSoundPackProvider(
				new CorroServer.Services.Sounds.DefaultSoundPackProvider()));
		foreach (var package in packages)
		{
			await store.StageFromDirectoryAsync(package, CorroTestPaths.PackageDir(package));
			// A shipped board remembers where it came from, so a table can restore it later.
			store.SetOrigin(package, new PackageOrigin { ShippedId = package });
		}
		var clients = new CapturingCallerClients();
		var hub = new GameHub(
			repository,
			gameServiceFactory: null!,
			timer,
			store,
			packageRestorer: null!,
			registry,
			NullLogger<GameHub>.Instance)
		{
			Clients = clients,
			Context = new FakeCallerContext("lobby-connection"),
			Groups = new NoopGroupManager(),
		};
		return new Harness(hub, clients, repository);
	}

	private static CreateGameRequest Create(string package, int maxPlayers) => new()
	{
		HostName = "Host",
		HostToken = "seat",
		Board = "Table",
		PackageToken = package,
		MaxPlayers = maxPlayers,
		Language = "es",
	};

	private static string? ErrorSent(CapturingCallerClients clients)
		=> clients.Caller.Sends.FirstOrDefault(send => send.Method == "Error")?.Args[0] as string;

	[Fact]
	public async Task A_bluffing_table_may_seat_a_hall_but_a_board_with_pieces_keeps_the_ordinary_ceiling()
	{
		var hall = await BuildAsync("tall-tales");
		await hall.Hub.CreateGameLobby(Create("tall-tales", 500));
		Assert.Null(ErrorSent(hall.Clients));
		var created = Assert.IsType<CreateGameResponse>(
			Assert.Single(hall.Clients.Caller.Sends, send => send.Method == "GameCreated").Args[0]);
		Assert.Equal(500, created.Game.MaxPlayers);
		Assert.Equal("bluff", created.Game.GameType);

		var board = await BuildAsync("letter-rush");
		await board.Hub.CreateGameLobby(Create("letter-rush", 500) with { HostToken = "quill" });
		Assert.Equal("INVALID_LOBBY_REQUEST", ErrorSent(board.Clients));
		Assert.DoesNotContain(board.Clients.Caller.Sends, send => send.Method == "GameCreated");
	}

	[Fact]
	public async Task Joining_a_bluffing_table_never_refuses_the_shared_placeholder_piece_and_says_there_are_none()
	{
		var h = await BuildAsync("tall-tales");
		await h.Hub.CreateGameLobby(Create("tall-tales", 500));
		var created = Assert.IsType<CreateGameResponse>(
			Assert.Single(h.Clients.Caller.Sends, send => send.Method == "GameCreated").Args[0]);

		foreach (var name in new[] { "Ana", "Berto" })
		{
			await h.Hub.JoinGameLobby(new JoinGameRequest
			{
				GameId = created.GameId,
				PlayerName = name,
				PlayerToken = "seat",
			});
		}

		Assert.Null(ErrorSent(h.Clients));
		Assert.Equal(2, h.Clients.Caller.Sends.Count(send => send.Method == "GameJoined"));
		var table = (await h.Repository.LoadGameAsync(created.GameId))!;
		Assert.Equal(3, table.Players.Count);
		Assert.All(table.Players, player => Assert.Equal("seat", player.Token));

		// The joinable projection carries the family's answer, so the join form can hide its picker.
		var info = await h.Hub.GetGameByInviteCode(created.Game.InviteCode);
		var usesTokens = info.GetType().GetProperty("usesTokens")!.GetValue(info);
		Assert.Equal(false, usesTokens);
	}

	[Fact]
	public async Task A_board_with_pieces_still_refuses_a_piece_already_taken()
	{
		var h = await BuildAsync("letter-rush");
		await h.Hub.CreateGameLobby(Create("letter-rush", 4) with { HostToken = "quill" });
		var created = Assert.IsType<CreateGameResponse>(
			Assert.Single(h.Clients.Caller.Sends, send => send.Method == "GameCreated").Args[0]);

		await h.Hub.JoinGameLobby(new JoinGameRequest
		{
			GameId = created.GameId,
			PlayerName = "Ana",
			PlayerToken = "quill",
		});

		Assert.Equal("TOKEN_IN_USE", ErrorSent(h.Clients));
	}
}
