using CorroServer.Models;
using CorroServer.Services;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The account-less seat recovery: a player's 8-character RE-ENTRY code reclaims their
/// seat from any browser — as long as the game is still playable and nobody is connected
/// on that seat — rotating the secret id so the claimer becomes the only owner. Also pins
/// the credential hygiene around it: codes are unambiguous, and every client-bound
/// document is stripped of secrets.
/// </summary>
public class RejoinTests
{
	private static (InMemoryGameRepository Repo, GameDocument Game) GameWith(
		GameStatus status = GameStatus.Active)
	{
		var repo = new InMemoryGameRepository();
		var game = new GameDocument
		{
			Id = "game-ABC123",
			GameId = "ABC123",
			Status = status,
			HostId = "host",
			InviteCode = "INV111",
			Players = new List<LobbyPlayer>
			{
				new() { Id = "host", Name = "Ana", Token = "estrella", IsHost = true, PlayerSecretId = "secret-ana", RejoinCode = "AAAABBBB" },
				new() { Id = "p2", Name = "Berto", Token = "luna", PlayerSecretId = "secret-berto", RejoinCode = "CCCCDDDD" },
			},
		};
		repo.CreateGameAsync(game).GetAwaiter().GetResult();
		return (repo, game);
	}

	private static readonly Func<string, IEnumerable<string>> NobodyConnected = _ => Array.Empty<string>();

	// ── the claim flow ───────────────────────────────────────────────────────

	[Fact]
	public async Task Claiming_a_free_seat_returns_the_session_and_rotates_the_secret()
	{
		var (repo, _) = GameWith();

		var result = await RejoinService.ClaimAsync("CCCCDDDD", repo, NobodyConnected);

		Assert.Null(result.Error);
		var session = result.Session!;
		Assert.Equal("ABC123", session.GameId);
		Assert.Equal("p2", session.PlayerId);
		Assert.Equal("Berto", session.PlayerName);
		Assert.Equal("CCCCDDDD", session.RejoinCode); // the code is the durable key: it does NOT rotate
		Assert.NotEqual("secret-berto", session.PlayerSecretId); // the secret DOES

		// The rotation is persisted: the old browser's credential is dead.
		var stored = await repo.LoadGameAsync("ABC123");
		var berto = stored!.Players.First(p => p.Id == "p2");
		Assert.Equal(session.PlayerSecretId, berto.PlayerSecretId);
		// Nobody else's credentials moved.
		Assert.Equal("secret-ana", stored.Players.First(p => p.Id == "host").PlayerSecretId);
	}

	[Fact]
	public async Task An_unknown_code_is_GAME_NOT_FOUND()
	{
		var (repo, _) = GameWith();
		var result = await RejoinService.ClaimAsync("ZZZZZZZZ", repo, NobodyConnected);
		Assert.Equal("GAME_NOT_FOUND", result.Error);
		Assert.Null(result.Session);
	}

	[Fact]
	public async Task A_finished_or_abandoned_game_cannot_be_reclaimed()
	{
		var (repo, _) = GameWith(GameStatus.Completed);
		var result = await RejoinService.ClaimAsync("CCCCDDDD", repo, NobodyConnected);
		Assert.Equal("GAME_OVER", result.Error);
	}

	[Fact]
	public async Task A_seat_with_somebody_connected_is_refused_and_nothing_rotates()
	{
		var (repo, _) = GameWith();

		var result = await RejoinService.ClaimAsync("CCCCDDDD", repo,
			gameId => new[] { "p2" }); // the legitimate (or any) session is live on it

		Assert.Equal("SEAT_CONNECTED", result.Error);
		var stored = await repo.LoadGameAsync("ABC123");
		Assert.Equal("secret-berto", stored!.Players.First(p => p.Id == "p2").PlayerSecretId);
	}

	[Fact]
	public async Task The_repository_finds_a_game_by_any_of_its_players_codes()
	{
		var (repo, _) = GameWith();
		Assert.NotNull(await repo.GetByRejoinCodeAsync("AAAABBBB"));
		Assert.NotNull(await repo.GetByRejoinCodeAsync("CCCCDDDD"));
		Assert.Null(await repo.GetByRejoinCodeAsync("NOPE9999"));
	}

	// ── the code itself ──────────────────────────────────────────────────────

	[Fact]
	public void Rejoin_codes_are_8_unambiguous_characters()
	{
		// No I/O/0/1: the code is dictated aloud and copied by ear.
		const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
		for (var i = 0; i < 50; i++)
		{
			var code = IdGenerator.RejoinCode();
			Assert.Equal(8, code.Length);
			Assert.All(code, c => Assert.Contains(c, alphabet));
		}
		Assert.NotEqual(IdGenerator.RejoinCode(), IdGenerator.RejoinCode());
	}

	// ── credential hygiene on client-bound documents ─────────────────────────

	[Fact]
	public void Sanitized_strips_every_players_credentials_and_leaves_the_original_intact()
	{
		var (_, game) = GameWith();

		var safe = game.Sanitized();

		Assert.All(safe.Players, p => Assert.Equal("", p.PlayerSecretId));
		Assert.All(safe.Players, p => Assert.Null(p.RejoinCode));
		// Public identity survives (the lobby list renders from this).
		Assert.Equal("Berto", safe.Players[1].Name);
		// The persisted document keeps the real credentials.
		Assert.Equal("secret-berto", game.Players[1].PlayerSecretId);
		Assert.Equal("CCCCDDDD", game.Players[1].RejoinCode);
	}
}
