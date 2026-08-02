using CorroServer.Services.Accounts;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Telling somebody that the login they just used made a SECOND account.
///
/// The matching rule — (issuer, subject), never the email — is what produces the situation and it
/// is not up for negotiation: two providers reporting one address are not proof of one person.
/// These pin the consolation prize, which is that nobody has to discover it by losing their tables.
///
/// The refusals matter more than the notice. Saying "an account already exists with this address"
/// answers a question about somebody else's data, so it is said only when the provider VERIFIED
/// the address — otherwise a stranger with their own Entra tenant could set an email attribute to
/// yours and ask this service whether you play here.
/// </summary>
public class SecondAccountNoticeTests
{
	private static UserAccountService NewService(InMemoryUserRepository repository) =>
		new(repository, NullLogger<UserAccountService>.Instance);

	private static ExternalIdentity Identity(
		string issuer, string subject, string? email, bool verified) =>
		new(issuer, subject, DisplayName: subject, Email: email, EmailVerified: verified);

	/// <summary>Sign somebody in for the first time and return both halves of the outcome.</summary>
	private static async Task<(UserAccountService Service, Models.UserDocument User)> SignInFirstAsync(
		InMemoryUserRepository repository, ExternalIdentity identity)
	{
		var service = NewService(repository);
		var user = await service.SignInAsync(identity, DateTime.UtcNow);
		return (service, user);
	}

	[Fact]
	public async Task A_second_account_with_the_same_verified_address_is_worth_saying()
	{
		var repository = new InMemoryUserRepository();
		await SignInFirstAsync(repository, Identity("google", "g-1", "juanjo@example.test", verified: true));

		var (service, second) = await SignInFirstAsync(
			repository, Identity("microsoft", "m-1", "juanjo@example.test", verified: true));

		Assert.True(await service.ShouldSuggestLinkingAsync(
			second, Identity("microsoft", "m-1", "juanjo@example.test", verified: true)));
	}

	[Fact]
	public async Task An_unverified_address_says_nothing_at_all()
	{
		// The nOAuth shape: a work/school Microsoft address is a directory attribute an admin sets,
		// so it is not evidence of anything. Answering here would leak whether an account exists.
		var repository = new InMemoryUserRepository();
		await SignInFirstAsync(repository, Identity("google", "g-1", "juanjo@example.test", verified: true));

		var (service, second) = await SignInFirstAsync(
			repository, Identity("microsoft", "m-1", "juanjo@example.test", verified: false));

		Assert.False(await service.ShouldSuggestLinkingAsync(
			second, Identity("microsoft", "m-1", "juanjo@example.test", verified: false)));
	}

	[Fact]
	public async Task The_first_account_anybody_makes_is_not_a_second_one()
	{
		var repository = new InMemoryUserRepository();

		var (service, only) = await SignInFirstAsync(
			repository, Identity("google", "g-1", "juanjo@example.test", verified: true));

		Assert.False(await service.ShouldSuggestLinkingAsync(
			only, Identity("google", "g-1", "juanjo@example.test", verified: true)));
	}

	[Fact]
	public async Task A_returning_player_is_not_told_again_every_time()
	{
		// Said once, when it happens. After that they know, and repeating it on every sign-in
		// would be nagging about something they have already decided to live with.
		var repository = new InMemoryUserRepository();
		await SignInFirstAsync(repository, Identity("google", "g-1", "juanjo@example.test", verified: true));
		var microsoft = Identity("microsoft", "m-1", "juanjo@example.test", verified: true);
		var service = NewService(repository);
		await service.SignInAsync(microsoft, DateTime.UtcNow);

		var returning = await service.SignInAsync(microsoft, DateTime.UtcNow.AddMinutes(5));

		Assert.False(await service.ShouldSuggestLinkingAsync(returning, microsoft));
	}

	[Fact]
	public async Task A_new_account_with_an_address_nobody_else_has_says_nothing()
	{
		var repository = new InMemoryUserRepository();
		await SignInFirstAsync(repository, Identity("google", "g-1", "ana@example.test", verified: true));

		var (service, second) = await SignInFirstAsync(
			repository, Identity("microsoft", "m-1", "berto@example.test", verified: true));

		Assert.False(await service.ShouldSuggestLinkingAsync(
			second, Identity("microsoft", "m-1", "berto@example.test", verified: true)));
	}

	[Fact]
	public async Task A_provider_that_reports_no_address_says_nothing()
	{
		// Facebook accounts can be created with a phone number and no email at all.
		var repository = new InMemoryUserRepository();
		await SignInFirstAsync(repository, Identity("google", "g-1", "juanjo@example.test", verified: true));

		var (service, second) = await SignInFirstAsync(
			repository, Identity("facebook", "f-1", null, verified: true));

		Assert.False(await service.ShouldSuggestLinkingAsync(
			second, Identity("facebook", "f-1", null, verified: true)));
	}

	[Fact]
	public async Task The_address_is_matched_regardless_of_capitals()
	{
		// Addresses are not case-sensitive in the part that matters, and a player typing theirs
		// into two providers with different capitals is the same person meeting the same surprise.
		var repository = new InMemoryUserRepository();
		await SignInFirstAsync(repository, Identity("google", "g-1", "Juanjo@Example.test", verified: true));

		var (service, second) = await SignInFirstAsync(
			repository, Identity("microsoft", "m-1", "juanjo@example.test", verified: true));

		Assert.True(await service.ShouldSuggestLinkingAsync(
			second, Identity("microsoft", "m-1", "juanjo@example.test", verified: true)));
	}
}
