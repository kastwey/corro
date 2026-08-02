using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Accounts;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Joining two accounts that turn out to be one person.
///
/// This does not weaken the (issuer, subject) rule; it rests on the same evidence that authorises
/// linking. The caller is signed into one account AND has just completed a login that opens the
/// other — holding both is what proves they own both. Nothing here is ever reached by asserting an
/// email address.
///
/// What these mostly pin is that NOTHING IS LOST: the seats change hands before anything is
/// deleted, and every table stays reachable at each step.
/// </summary>
public class AccountMergeTests
{
	private static ExternalIdentity Id(string issuer, string subject) =>
		new(issuer, subject, DisplayName: subject, Email: "juanjo@example.test", EmailVerified: true);

	private static UserAccountService NewService(InMemoryUserRepository users) =>
		new(users, NullLogger<UserAccountService>.Instance);

	private static GameDocument TableFor(string gameId, string userId) => new()
	{
		Id = $"game-{gameId}",
		GameId = gameId,
		Status = GameStatus.WaitingForPlayers,
		HostId = "p1",
		InviteCode = gameId,
		Players = new List<LobbyPlayer>
		{
			new()
			{
				Id = "p1", Name = "Ana", Token = "disc", IsHost = true,
				PlayerSecretId = "secret", RejoinCode = "AAAABBBB", UserId = userId,
			},
		},
	};

	/// <summary>Two accounts for one person: an older one with a table, and a newer one.</summary>
	private static async Task<(InMemoryUserRepository Users, InMemoryGameRepository Games,
		UserAccountService Service, UserDocument Older, UserDocument Newer)> TwoAccountsAsync()
	{
		var users = new InMemoryUserRepository();
		var games = new InMemoryGameRepository();
		var service = NewService(users);

		var older = await service.SignInAsync(Id("google", "g-1"), new DateTime(2026, 1, 1));
		await games.CreateGameAsync(TableFor("OLD111", older.UserId));

		var newer = await service.SignInAsync(Id("microsoft", "m-1"), new DateTime(2026, 6, 1));
		return (users, games, service, older, newer);
	}

	[Fact]
	public async Task Proving_both_logins_joins_the_accounts_and_keeps_the_older_one()
	{
		var (users, games, service, older, newer) = await TwoAccountsAsync();

		var result = await service.MergeAccountsAsync(
			signedInUserId: newer.UserId,
			provenIdentity: Id("google", "g-1"),
			reassignSeats: games.ReassignSeatsAsync,
			utcNow: DateTime.UtcNow);

		Assert.Equal(MergeOutcome.Merged, result.Outcome);
		Assert.Equal(older.UserId, result.User!.UserId);
		// Both logins now open it, which is the whole point.
		Assert.Equal(
			new[] { "google", "microsoft" },
			result.User.Identities.Select(i => i.Issuer).OrderBy(i => i));
		// …and the account that disappeared is gone rather than left as an unreachable shell.
		Assert.Null(await users.GetUserAsync(newer.UserId));
	}

	[Fact]
	public async Task Every_table_survives_and_answers_to_the_surviving_account()
	{
		// The table was the OLDER account's, so it must still be there; and a table belonging to the
		// account that disappears has to come across rather than vanish with it.
		var (_, games, service, older, newer) = await TwoAccountsAsync();
		await games.CreateGameAsync(TableFor("NEW222", newer.UserId));

		var result = await service.MergeAccountsAsync(
			newer.UserId, Id("google", "g-1"), games.ReassignSeatsAsync, DateTime.UtcNow);

		Assert.Equal(1, result.SeatsMoved);
		var tables = await games.GetGamesForUserAsync(older.UserId, 10);
		Assert.Equal(new[] { "NEW222", "OLD111" }, tables.Select(t => t.GameId).OrderBy(g => g));
		Assert.Empty(await games.GetGamesForUserAsync(newer.UserId, 10));
	}

	[Fact]
	public async Task A_moved_seat_keeps_its_credentials_so_a_browser_mid_game_carries_on()
	{
		// Only the OWNER changes. Anything else would log somebody out of a game they are playing.
		var (_, games, service, older, newer) = await TwoAccountsAsync();
		await games.CreateGameAsync(TableFor("NEW222", newer.UserId));

		await service.MergeAccountsAsync(
			newer.UserId, Id("google", "g-1"), games.ReassignSeatsAsync, DateTime.UtcNow);

		var seat = (await games.LoadGameAsync("NEW222"))!.Players.Single();
		Assert.Equal(older.UserId, seat.UserId);
		Assert.Equal("secret", seat.PlayerSecretId);
		Assert.Equal("AAAABBBB", seat.RejoinCode);
		Assert.Equal("p1", seat.Id);
	}

	[Fact]
	public async Task It_works_from_either_side_and_still_keeps_the_older_account()
	{
		// The player may be signed into either one when they prove the other. Which account survives
		// is decided by age, not by which session happens to be open.
		var (users, games, service, older, newer) = await TwoAccountsAsync();

		var result = await service.MergeAccountsAsync(
			signedInUserId: older.UserId,
			provenIdentity: Id("microsoft", "m-1"),
			reassignSeats: games.ReassignSeatsAsync,
			utcNow: DateTime.UtcNow);

		Assert.Equal(MergeOutcome.Merged, result.Outcome);
		Assert.Equal(older.UserId, result.User!.UserId);
		Assert.Null(await users.GetUserAsync(newer.UserId));
	}

	[Fact]
	public async Task A_login_nobody_else_holds_is_not_a_merge()
	{
		// The ordinary link case: adding a provider that belongs to no one. Nothing to join, and the
		// caller falls through to the normal linking path.
		var (_, games, service, _, newer) = await TwoAccountsAsync();

		var result = await service.MergeAccountsAsync(
			newer.UserId, Id("facebook", "f-1"), games.ReassignSeatsAsync, DateTime.UtcNow);

		Assert.Equal(MergeOutcome.NothingToMerge, result.Outcome);
	}

	[Fact]
	public async Task Proving_a_login_the_account_already_has_changes_nothing()
	{
		var (_, games, service, _, newer) = await TwoAccountsAsync();

		var result = await service.MergeAccountsAsync(
			newer.UserId, Id("microsoft", "m-1"), games.ReassignSeatsAsync, DateTime.UtcNow);

		Assert.Equal(MergeOutcome.NothingToMerge, result.Outcome);
	}

	[Fact]
	public async Task When_both_accounts_use_the_same_provider_the_survivor_keeps_its_own_login()
	{
		// An account holds at most one login per provider, so a duplicate provider cannot be
		// adopted. The absorbed one is dropped rather than left pointing at a deleted account.
		var users = new InMemoryUserRepository();
		var games = new InMemoryGameRepository();
		var service = NewService(users);
		var older = await service.SignInAsync(Id("google", "g-old"), new DateTime(2026, 1, 1));
		var newer = await service.SignInAsync(Id("google", "g-new"), new DateTime(2026, 6, 1));
		// Give them a shared second provider so there is something to prove.
		await service.LinkIdentityAsync(newer.UserId, Id("microsoft", "m-1"), DateTime.UtcNow);

		var result = await service.MergeAccountsAsync(
			older.UserId, Id("microsoft", "m-1"), games.ReassignSeatsAsync, DateTime.UtcNow);

		Assert.Equal(MergeOutcome.Merged, result.Outcome);
		Assert.Equal(older.UserId, result.User!.UserId);
		// One Google, and it is the survivor's own.
		var google = Assert.Single(result.User.Identities, i => i.Issuer == "google");
		Assert.Equal("g-old", google.Subject);
		// The absorbed Google login resolves to nothing, rather than to an account that is gone.
		Assert.Null(await users.GetIdentityLinkAsync(IdentityKey.For("google", "g-new")));
	}
}
