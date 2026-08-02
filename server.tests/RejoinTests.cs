using CorroServer.Models;
using CorroServer.Services;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Seat recovery, by either proof: the account-less 8-character RE-ENTRY code, and the signed-in
/// ACCOUNT the seat recorded when it was taken. Both reclaim a seat from any browser as long as
/// the game is still playable and nobody is connected on that seat, and both rotate the secret id
/// so the claimer becomes the only owner. Also pins the credential hygiene around it: codes are
/// unambiguous, and every client-bound document is stripped of secrets.
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
				new() { Id = "host", Name = "Ana", Token = "star", IsHost = true, PlayerSecretId = "secret-ana", RejoinCode = "AAAABBBB", UserId = "user-ana" },
				new() { Id = "p2", Name = "Berto", Token = "moon", PlayerSecretId = "secret-berto", RejoinCode = "CCCCDDDD" },
			},
		};
		repo.CreateGameAsync(game).GetAwaiter().GetResult();
		return (repo, game);
	}

	private static readonly Func<string, IEnumerable<string>> NobodyConnected = _ => Array.Empty<string>();

	// ── claiming with an account instead of a code ───────────────────────────
	//
	// Same seat, same guards, a different proof. The point of the account path is that there is
	// nothing to have kept: a new device with the same session is the same person coming back.

	[Fact]
	public async Task An_account_reclaims_its_own_seat_without_any_code()
	{
		var (repo, _) = GameWith();

		var result = await RejoinService.ClaimForUserAsync("ABC123", "user-ana", repo, NobodyConnected);

		Assert.Null(result.Error);
		Assert.Equal("host", result.Session!.PlayerId);
		Assert.Equal("Ana", result.Session.PlayerName);
		// Rotated, exactly as the code path does: an old browser holding the previous secret loses it.
		Assert.NotEqual("secret-ana", result.Session.PlayerSecretId);
		// …and the player gets their own re-entry code back, so the new browser can store it.
		Assert.Equal("AAAABBBB", result.Session.RejoinCode);
	}

	[Fact]
	public async Task An_account_cannot_claim_a_seat_that_is_not_its_own()
	{
		// Berto's seat is anonymous, and no account may adopt it by asking. This is the whole
		// security of the path: the seat says whose it is, the claimer does not.
		var (repo, _) = GameWith();

		var result = await RejoinService.ClaimForUserAsync("ABC123", "user-berto", repo, NobodyConnected);

		Assert.Equal("GAME_NOT_FOUND", result.Error);
		Assert.Null(result.Session);
	}

	[Fact]
	public async Task An_account_cannot_evict_a_seat_somebody_is_sitting_on()
	{
		// The same refusal the code path gives, and for the same reason: signing in elsewhere must
		// not throw you out of the table you are actually playing at.
		var (repo, _) = GameWith();

		var result = await RejoinService.ClaimForUserAsync(
			"ABC123", "user-ana", repo, _ => new[] { "host" });

		Assert.Equal("SEAT_CONNECTED", result.Error);
	}

	[Fact]
	public async Task An_account_cannot_claim_a_seat_at_a_table_that_is_over()
	{
		var (repo, _) = GameWith(GameStatus.Completed);

		Assert.Equal("GAME_OVER",
			(await RejoinService.ClaimForUserAsync("ABC123", "user-ana", repo, NobodyConnected)).Error);
	}

	[Fact]
	public async Task An_unknown_table_is_the_same_refusal_as_an_unknown_seat()
	{
		var (repo, _) = GameWith();

		Assert.Equal("GAME_NOT_FOUND",
			(await RejoinService.ClaimForUserAsync("NOPE", "user-ana", repo, NobodyConnected)).Error);
	}

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
