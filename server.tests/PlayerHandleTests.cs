using CorroServer.Models;
using CorroServer.Services.Accounts;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The public name a player is found by. Two things here are security, not tidiness: a handle
/// nobody else can hold at the same time, and a handle nobody can inherit the moment it is let go.
///
/// The narrow alphabet is the impersonation defence. In an app built for people who cannot SEE
/// that "kаstwey" carries a Cyrillic а, a name that can be forged visually is a name that cannot
/// be trusted — and restricting the characters removes the whole class of attack outright.
/// </summary>
public class PlayerHandleTests
{
	private static readonly DateTime Now = new(2026, 8, 3, 12, 0, 0, DateTimeKind.Utc);

	private static UserAccountService NewService(out InMemoryUserRepository repository)
	{
		repository = new InMemoryUserRepository();
		return new UserAccountService(repository, NullLogger<UserAccountService>.Instance);
	}

	private static async Task<UserDocument> NewAccountAsync(InMemoryUserRepository repository, string userId)
		=> await repository.UpsertUserAsync(new UserDocument
		{
			Id = userId,
			UserId = userId,
			DisplayName = "Juan José",
			CreatedAtUtc = Now,
		});

	[Theory]
	[InlineData("kastwey")]
	[InlineData("Kastwey")]
	[InlineData("a_b_c")]
	[InlineData("player2000")]
	public void Plain_ascii_handles_are_accepted(string handle)
		=> Assert.Equal(PlayerHandle.Rejection.None, PlayerHandle.Validate(handle));

	[Theory]
	// A Cyrillic а: identical on screen, identical read aloud, a different person.
	[InlineData("kаstwey", PlayerHandle.Rejection.BadCharacters)]
	[InlineData("núria", PlayerHandle.Rejection.BadCharacters)]
	[InlineData("with space", PlayerHandle.Rejection.BadCharacters)]
	[InlineData("2fast", PlayerHandle.Rejection.BadCharacters)]   // must start with a letter
	[InlineData("_leading", PlayerHandle.Rejection.BadCharacters)]
	[InlineData("ab", PlayerHandle.Rejection.TooShort)]
	[InlineData("", PlayerHandle.Rejection.TooShort)]
	[InlineData("abcdefghijklmnopqrstuvwxyz", PlayerHandle.Rejection.TooLong)]
	[InlineData("admin", PlayerHandle.Rejection.Reserved)]
	[InlineData("ADMIN", PlayerHandle.Rejection.Reserved)]
	[InlineData("corro", PlayerHandle.Rejection.Reserved)]
	public void Everything_else_is_refused_with_a_reason(string handle, PlayerHandle.Rejection expected)
		=> Assert.Equal(expected, PlayerHandle.Validate(handle));

	[Fact]
	public async Task A_handle_is_claimed_once_and_shown_as_typed()
	{
		var service = NewService(out var repository);
		await NewAccountAsync(repository, "u1");

		var result = await service.SetHandleAsync("u1", "Kastwey", Now);

		Assert.Equal(UserAccountService.HandleOutcome.Ok, result.Outcome);
		Assert.Equal("Kastwey", result.User!.Handle);          // shown as chosen…
		var claim = await repository.GetHandleClaimAsync("kastwey");
		Assert.Equal("u1", claim!.UserId);                      // …and locked in lower case
	}

	// The same guard first sign-in uses: the NAME is claimed before the account is written, so the
	// loser of a race is told no rather than both being told yes.
	[Fact]
	public async Task Two_players_asking_for_one_name_cannot_both_have_it()
	{
		var service = NewService(out var repository);
		await NewAccountAsync(repository, "u1");
		await NewAccountAsync(repository, "u2");

		var first = await service.SetHandleAsync("u1", "ana", Now);
		var second = await service.SetHandleAsync("u2", "ANA", Now);

		Assert.Equal(UserAccountService.HandleOutcome.Ok, first.Outcome);
		Assert.Equal(UserAccountService.HandleOutcome.Taken, second.Outcome);
		Assert.Equal("u1", (await repository.GetHandleClaimAsync("ana"))!.UserId);
	}

	[Fact]
	public async Task A_handle_holds_still_for_thirty_days()
	{
		var service = NewService(out var repository);
		await NewAccountAsync(repository, "u1");
		await service.SetHandleAsync("u1", "first", Now);

		var tooSoon = await service.SetHandleAsync("u1", "second", Now.AddDays(29));
		Assert.Equal(UserAccountService.HandleOutcome.TooSoon, tooSoon.Outcome);
		Assert.Equal(Now.AddDays(30), tooSoon.ChangeableAtUtc);

		var allowed = await service.SetHandleAsync("u1", "second", Now.AddDays(30));
		Assert.Equal(UserAccountService.HandleOutcome.Ok, allowed.Outcome);
		Assert.Equal("second", allowed.User!.Handle);
	}

	// Restyling is not changing: somebody fixing their own capitalisation must not spend the thirty
	// days they might need for a real change.
	[Fact]
	public async Task Re_typing_the_same_name_only_restyles_it()
	{
		var service = NewService(out var repository);
		await NewAccountAsync(repository, "u1");
		await service.SetHandleAsync("u1", "kastwey", Now);

		var restyled = await service.SetHandleAsync("u1", "KastWey", Now.AddDays(1));

		Assert.Equal(UserAccountService.HandleOutcome.Ok, restyled.Outcome);
		Assert.Equal("KastWey", restyled.User!.Handle);
		Assert.Equal(Now, restyled.User.HandleChangedAtUtc);   // the clock did not restart
	}

	// The impersonation window: a name released today and grabbed this afternoon would let a
	// stranger wear it in front of everyone who learned it yesterday.
	[Fact]
	public async Task A_released_name_is_untakeable_until_it_has_cooled_down()
	{
		var service = NewService(out var repository);
		await NewAccountAsync(repository, "u1");
		await NewAccountAsync(repository, "u2");
		await service.SetHandleAsync("u1", "kastwey", Now);
		await service.SetHandleAsync("u1", "elsewhere", Now.AddDays(30));   // lets "kastwey" go

		var tooEarly = await service.SetHandleAsync("u2", "kastwey", Now.AddDays(31));
		Assert.Equal(UserAccountService.HandleOutcome.Taken, tooEarly.Outcome);

		var allowed = await service.SetHandleAsync("u2", "kastwey", Now.AddDays(61));
		Assert.Equal(UserAccountService.HandleOutcome.Ok, allowed.Outcome);
	}

	[Fact]
	public async Task Its_previous_owner_may_take_their_own_name_back()
	{
		var service = NewService(out var repository);
		await NewAccountAsync(repository, "u1");
		await service.SetHandleAsync("u1", "kastwey", Now);
		await service.SetHandleAsync("u1", "elsewhere", Now.AddDays(30));

		// Nobody was impersonated by this: it was theirs.
		var back = await service.SetHandleAsync("u1", "kastwey", Now.AddDays(60));

		Assert.Equal(UserAccountService.HandleOutcome.Ok, back.Outcome);
		Assert.Equal("kastwey", back.User!.Handle);
	}

	// Erasure must not strand the name: keeping the claim as RELEASED is what stops somebody
	// picking up a deleted player's identity the same afternoon.
	[Fact]
	public async Task Deleting_an_account_releases_its_name_rather_than_freeing_it()
	{
		var service = NewService(out var repository);
		await NewAccountAsync(repository, "u1");
		await NewAccountAsync(repository, "u2");
		await service.SetHandleAsync("u1", "kastwey", Now);

		await service.DeleteAccountAsync("u1");

		var claim = await repository.GetHandleClaimAsync("kastwey");
		Assert.NotNull(claim);
		Assert.NotNull(claim!.ReleasedAtUtc);
		Assert.Equal(
			UserAccountService.HandleOutcome.Taken,
			(await service.SetHandleAsync("u2", "kastwey", Now.AddDays(1))).Outcome);
		Assert.Equal(
			UserAccountService.HandleOutcome.Ok,
			(await service.SetHandleAsync("u2", "kastwey", Now.AddDays(31))).Outcome);
	}

	[Fact]
	public async Task Availability_never_says_who_holds_a_name()
	{
		var service = NewService(out var repository);
		await NewAccountAsync(repository, "u1");
		await NewAccountAsync(repository, "u2");
		await service.SetHandleAsync("u1", "kastwey", Now);

		Assert.False(await service.IsHandleAvailableAsync("kastwey", "u2", Now));
		Assert.True(await service.IsHandleAvailableAsync("kastwey", "u1", Now), "your own name is yours");
		Assert.True(await service.IsHandleAvailableAsync("freename", "u2", Now));
		Assert.False(await service.IsHandleAvailableAsync("admin", "u2", Now));
		Assert.False(await service.IsHandleAvailableAsync("núria", "u2", Now));
	}

	// The list publishes the HANDLE and never the display name, which is seeded from the provider
	// and is usually somebody's real name. Appearing at all is the player's own decision.
	[Fact]
	public async Task Being_listed_is_off_until_the_player_turns_it_on()
	{
		var service = NewService(out var repository);
		var created = await NewAccountAsync(repository, "u1");
		Assert.False(created.ListedPublicly);

		var listed = await service.SetListedPubliclyAsync("u1", true);
		Assert.True(listed!.ListedPublicly);

		var hidden = await service.SetListedPubliclyAsync("u1", false);
		Assert.False(hidden!.ListedPublicly);
	}
}
