using CorroServer.Models;
using CorroServer.Services.Accounts;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The sign-in policy: how a completed provider login becomes an account. The rule these tests
/// exist to protect is that accounts are matched on (issuer, subject) and NOTHING else — above all
/// never on the email address, which providers hand out unverified and reassign.
/// </summary>
public class UserAccountServiceTests
{
	private static readonly DateTime Now = new(2026, 7, 26, 12, 0, 0, DateTimeKind.Utc);

	private static (UserAccountService Service, InMemoryUserRepository Repo) NewService()
	{
		var repo = new InMemoryUserRepository();
		return (new UserAccountService(repo, NullLogger<UserAccountService>.Instance), repo);
	}

	private static ExternalIdentity Identity(
		string issuer = AuthProviders.Google,
		string subject = "1234567890",
		string? displayName = "Ana",
		string? email = "ana@example.com") => new(issuer, subject, displayName, email);

	// ── first sign-in ────────────────────────────────────────────────────────

	[Fact]
	public async Task First_sign_in_creates_an_account_that_records_the_identity()
	{
		var (service, _) = NewService();

		var user = await service.SignInAsync(Identity(), Now);

		Assert.NotEmpty(user.UserId);
		Assert.Equal("Ana", user.DisplayName);
		Assert.Equal("ana@example.com", user.Email);
		Assert.Equal(Now, user.CreatedAtUtc);
		var identity = Assert.Single(user.Identities);
		Assert.Equal(AuthProviders.Google, identity.Issuer);
		Assert.Equal("1234567890", identity.Subject);
	}

	[Fact]
	public async Task Signing_in_again_returns_the_same_account()
	{
		var (service, _) = NewService();

		var first = await service.SignInAsync(Identity(), Now);
		var second = await service.SignInAsync(Identity(), Now.AddDays(3));

		Assert.Equal(first.UserId, second.UserId);
		Assert.Single(second.Identities);
		Assert.Equal(Now, second.CreatedAtUtc);
		Assert.Equal(Now.AddDays(3), second.LastSignInUtc);
	}

	// ── identity is the pair, never the address ──────────────────────────────

	[Fact]
	public async Task The_same_email_from_two_providers_creates_two_separate_accounts()
	{
		// The account-takeover case this design exists to prevent: signing in to a provider that
		// never verified the address must not hand over the account created through another one.
		var (service, _) = NewService();

		var google = await service.SignInAsync(Identity(AuthProviders.Google, "g-1", email: "same@example.com"), Now);
		var microsoft = await service.SignInAsync(Identity(AuthProviders.Microsoft, "m-1", email: "same@example.com"), Now);

		Assert.NotEqual(google.UserId, microsoft.UserId);
	}

	[Fact]
	public async Task Two_subjects_from_one_provider_are_two_accounts()
	{
		var (service, _) = NewService();

		var first = await service.SignInAsync(Identity(subject: "aaa"), Now);
		var second = await service.SignInAsync(Identity(subject: "bbb"), Now);

		Assert.NotEqual(first.UserId, second.UserId);
	}

	[Fact]
	public async Task A_changed_email_does_not_change_which_account_is_resolved()
	{
		// Providers let people change their address. The subject is what stays put, so the account
		// must follow the subject and simply absorb the new address.
		var (service, _) = NewService();

		var before = await service.SignInAsync(Identity(email: "old@example.com"), Now);
		var after = await service.SignInAsync(Identity(email: "new@example.com"), Now.AddDays(1));

		Assert.Equal(before.UserId, after.UserId);
		Assert.Equal("new@example.com", Assert.Single(after.Identities).Email);
	}

	// ── concurrency ──────────────────────────────────────────────────────────

	[Fact]
	public async Task Simultaneous_first_sign_ins_converge_on_one_account()
	{
		// Two tabs finishing the same login at once must not end up as two accounts, one of which
		// the player can never reach again.
		var (service, repo) = NewService();

		var results = await Task.WhenAll(
			Enumerable.Range(0, 8).Select(_ => service.SignInAsync(Identity(), Now)));

		Assert.Single(results.Select(u => u.UserId).Distinct());
		Assert.NotNull(await repo.GetIdentityLinkAsync(IdentityKey.For(AuthProviders.Google, "1234567890")));
	}

	[Fact]
	public async Task A_login_claimed_by_another_request_adopts_that_account()
	{
		// The branch where this request loses the race: the stored mapping wins and the account it
		// points at is the one returned, so the freshly minted id is discarded.
		var (service, repo) = NewService();
		var key = IdentityKey.For(AuthProviders.Google, "1234567890");
		await repo.CreateOrGetIdentityLinkAsync(new IdentityLinkDocument
		{
			Id = key,
			IdentityKey = key,
			UserId = "winner",
			CreatedAtUtc = Now,
		});

		var user = await service.SignInAsync(Identity(), Now);

		Assert.Equal("winner", user.UserId);
	}

	// ── healing a half-written account ───────────────────────────────────────

	[Fact]
	public async Task An_identity_pointing_at_a_missing_account_recreates_it_under_the_same_id()
	{
		// The mapping is stored before the account document, so a crash in between leaves a mapping
		// pointing at nothing. Reusing the id is what keeps the player's identity stable instead of
		// stranding them behind a mapping they can never get past.
		var (service, repo) = NewService();
		var key = IdentityKey.For(AuthProviders.Google, "1234567890");
		await repo.CreateOrGetIdentityLinkAsync(new IdentityLinkDocument
		{
			Id = key,
			IdentityKey = key,
			UserId = "orphaned",
			CreatedAtUtc = Now,
		});

		var user = await service.SignInAsync(Identity(), Now);

		Assert.Equal("orphaned", user.UserId);
		Assert.Equal(AuthProviders.Google, Assert.Single(user.Identities).Issuer);
	}

	[Fact]
	public async Task An_identity_missing_from_the_account_document_is_recorded_again()
	{
		var (service, repo) = NewService();
		var first = await service.SignInAsync(Identity(), Now);
		await repo.UpsertUserAsync(first with { Identities = new List<LinkedIdentity>() });

		var healed = await service.SignInAsync(Identity(), Now.AddMinutes(1));

		Assert.Equal(first.UserId, healed.UserId);
		Assert.Single(healed.Identities);
	}

	// ── profile handling ─────────────────────────────────────────────────────

	[Fact]
	public async Task A_provider_name_the_player_has_since_edited_is_not_overwritten()
	{
		var (service, repo) = NewService();
		var created = await service.SignInAsync(Identity(displayName: "Ana"), Now);
		await repo.UpsertUserAsync(created with { DisplayName = "Ana la Roja" });

		var user = await service.SignInAsync(Identity(displayName: "Ana"), Now.AddDays(1));

		Assert.Equal("Ana la Roja", user.DisplayName);
	}

	[Theory]
	[InlineData(null)]
	[InlineData("")]
	[InlineData("   ")]
	public async Task A_provider_that_supplies_no_name_leaves_it_null_for_the_client_to_localize(string? name)
	{
		// Storing an English placeholder here would freeze it into the database and show it to
		// Spanish players; the client renders the localized fallback instead.
		var (service, _) = NewService();

		var user = await service.SignInAsync(Identity(displayName: name), Now);

		Assert.Null(user.DisplayName);
	}

	[Fact]
	public async Task Surrounding_whitespace_in_a_provider_profile_is_trimmed()
	{
		var (service, _) = NewService();

		var user = await service.SignInAsync(Identity(displayName: "  Ana  ", email: " ana@example.com "), Now);

		Assert.Equal("Ana", user.DisplayName);
		Assert.Equal("ana@example.com", user.Email);
	}

	// ── linking a second provider ────────────────────────────────────────────

	[Fact]
	public async Task Linking_a_second_provider_puts_both_logins_on_one_account()
	{
		// The ONLY way two providers end up together: the player, already signed in, proves they
		// hold the second login too.
		var (service, _) = NewService();
		var account = await service.SignInAsync(Identity(AuthProviders.Google, "g-1"), Now);

		var result = await service.LinkIdentityAsync(
			account.UserId,
			Identity(AuthProviders.Microsoft, "m-1", email: "ana@outlook.com"),
			Now.AddMinutes(5));

		Assert.Equal(LinkOutcome.Linked, result.Outcome);
		Assert.Equal(2, result.User!.Identities.Count);
	}

	[Fact]
	public async Task Either_linked_provider_then_signs_in_to_the_same_account()
	{
		// The whole point of linking. If this did not hold, the second provider would still be a
		// separate account and the link would be decorative.
		var (service, _) = NewService();
		var account = await service.SignInAsync(Identity(AuthProviders.Google, "g-1"), Now);
		await service.LinkIdentityAsync(account.UserId, Identity(AuthProviders.Microsoft, "m-1"), Now);

		var viaGoogle = await service.SignInAsync(Identity(AuthProviders.Google, "g-1"), Now.AddDays(1));
		var viaMicrosoft = await service.SignInAsync(Identity(AuthProviders.Microsoft, "m-1"), Now.AddDays(2));

		Assert.Equal(account.UserId, viaGoogle.UserId);
		Assert.Equal(account.UserId, viaMicrosoft.UserId);
	}

	[Fact]
	public async Task A_login_another_account_owns_cannot_be_linked_away_from_it()
	{
		// The takeover this design prevents, approached from the other side: linking must never
		// MOVE a provider off whoever currently holds it.
		var (service, _) = NewService();
		var ana = await service.SignInAsync(Identity(AuthProviders.Google, "g-ana"), Now);
		var berto = await service.SignInAsync(Identity(AuthProviders.Microsoft, "m-berto"), Now);

		var result = await service.LinkIdentityAsync(
			ana.UserId,
			Identity(AuthProviders.Microsoft, "m-berto"),
			Now.AddMinutes(1));

		Assert.Equal(LinkOutcome.ClaimedByAnotherAccount, result.Outcome);
		// Berto still signs in to his own account, untouched.
		var bertoAgain = await service.SignInAsync(Identity(AuthProviders.Microsoft, "m-berto"), Now.AddHours(1));
		Assert.Equal(berto.UserId, bertoAgain.UserId);
		Assert.Single(bertoAgain.Identities);
	}

	[Fact]
	public async Task Linking_the_login_already_on_this_account_changes_nothing()
	{
		var (service, _) = NewService();
		var account = await service.SignInAsync(Identity(), Now);

		var result = await service.LinkIdentityAsync(account.UserId, Identity(), Now.AddMinutes(1));

		Assert.Equal(LinkOutcome.AlreadyLinked, result.Outcome);
		Assert.Single(result.User!.Identities);
	}

	[Fact]
	public async Task An_account_holds_at_most_one_login_per_provider()
	{
		// One per issuer is what lets the settings screen show a single row per provider and lets
		// "unlink Google" mean exactly one thing.
		var (service, _) = NewService();
		var account = await service.SignInAsync(Identity(AuthProviders.Google, "g-1"), Now);

		var result = await service.LinkIdentityAsync(
			account.UserId,
			Identity(AuthProviders.Google, "g-2"),
			Now.AddMinutes(1));

		Assert.Equal(LinkOutcome.ProviderAlreadyUsed, result.Outcome);
		Assert.Single(result.User!.Identities);
	}

	[Fact]
	public async Task Linking_into_an_account_that_no_longer_exists_is_refused()
	{
		var (service, _) = NewService();

		var result = await service.LinkIdentityAsync("erased", Identity(), Now);

		Assert.Equal(LinkOutcome.AccountNotFound, result.Outcome);
		Assert.Null(result.User);
	}

	// ── unlinking ────────────────────────────────────────────────────────────

	[Fact]
	public async Task Unlinking_frees_the_login_for_a_fresh_account()
	{
		var (service, _) = NewService();
		var account = await service.SignInAsync(Identity(AuthProviders.Google, "g-1"), Now);
		await service.LinkIdentityAsync(account.UserId, Identity(AuthProviders.Microsoft, "m-1"), Now);

		var result = await service.UnlinkIdentityAsync(account.UserId, AuthProviders.Microsoft);

		Assert.Equal(UnlinkOutcome.Unlinked, result.Outcome);
		Assert.Equal(AuthProviders.Google, Assert.Single(result.User!.Identities).Issuer);

		// The released login is genuinely free: signing in with it starts its own account.
		var reused = await service.SignInAsync(Identity(AuthProviders.Microsoft, "m-1"), Now.AddDays(1));
		Assert.NotEqual(account.UserId, reused.UserId);
	}

	[Fact]
	public async Task The_last_remaining_login_cannot_be_unlinked()
	{
		// Allowing it would leave an account nobody can ever sign into again — the data would still
		// be there, permanently unreachable. Erasing the account is the deliberate way out.
		var (service, _) = NewService();
		var account = await service.SignInAsync(Identity(), Now);

		var result = await service.UnlinkIdentityAsync(account.UserId, AuthProviders.Google);

		Assert.Equal(UnlinkOutcome.WouldLockAccountOut, result.Outcome);
		Assert.Single(result.User!.Identities);
		// Still reachable.
		Assert.Equal(account.UserId, (await service.SignInAsync(Identity(), Now.AddDays(1))).UserId);
	}

	[Fact]
	public async Task Unlinking_a_provider_that_was_never_linked_reports_it()
	{
		var (service, _) = NewService();
		var account = await service.SignInAsync(Identity(AuthProviders.Google, "g-1"), Now);

		var result = await service.UnlinkIdentityAsync(account.UserId, AuthProviders.Microsoft);

		Assert.Equal(UnlinkOutcome.NotLinked, result.Outcome);
	}

	[Fact]
	public async Task Unlinking_from_an_account_that_no_longer_exists_is_refused()
	{
		var (service, _) = NewService();

		var result = await service.UnlinkIdentityAsync("erased", AuthProviders.Google);

		Assert.Equal(UnlinkOutcome.AccountNotFound, result.Outcome);
	}

	// ── renaming ─────────────────────────────────────────────────────────────

	[Fact]
	public async Task Renaming_sets_the_name_other_players_see()
	{
		var (service, _) = NewService();
		var account = await service.SignInAsync(Identity(displayName: "Ana"), Now);

		var renamed = await service.RenameAsync(account.UserId, "  Ana la Roja  ");

		Assert.Equal("Ana la Roja", renamed!.DisplayName);
	}

	[Fact]
	public async Task A_rename_survives_the_next_sign_in()
	{
		// The provider keeps sending its own version of the name; it must not win.
		var (service, _) = NewService();
		var account = await service.SignInAsync(Identity(displayName: "Ana"), Now);
		await service.RenameAsync(account.UserId, "Ana la Roja");

		var next = await service.SignInAsync(Identity(displayName: "Ana"), Now.AddDays(1));

		Assert.Equal("Ana la Roja", next.DisplayName);
	}

	[Theory]
	[InlineData(null)]
	[InlineData("")]
	[InlineData("   ")]
	public async Task Clearing_the_name_returns_to_the_localized_placeholder(string? blank)
	{
		// Storing "" would render as an empty label; null is what makes the client fall back.
		var (service, _) = NewService();
		var account = await service.SignInAsync(Identity(displayName: "Ana"), Now);

		var renamed = await service.RenameAsync(account.UserId, blank);

		Assert.Null(renamed!.DisplayName);
	}

	[Fact]
	public async Task Renaming_an_account_that_no_longer_exists_yields_nothing()
	{
		var (service, _) = NewService();

		Assert.Null(await service.RenameAsync("erased", "Ana"));
	}

	[Fact]
	public void A_name_a_player_typed_is_rejected_when_too_long_rather_than_truncated()
	{
		// They can fix it, and silently shortening what somebody typed is surprising.
		var limit = UserAccountService.MaxDisplayNameLength;

		Assert.True(UserAccountService.IsValidDisplayName(new string('a', limit)));
		Assert.True(UserAccountService.IsValidDisplayName($"  {new string('a', limit)}  "));
		Assert.True(UserAccountService.IsValidDisplayName(null));
		Assert.False(UserAccountService.IsValidDisplayName(new string('a', limit + 1)));
	}

	[Fact]
	public async Task A_name_a_provider_supplied_is_truncated_rather_than_rejected()
	{
		// The player cannot correct what the provider sent, so refusing it would just block their
		// sign-in over a cosmetic field.
		var (service, _) = NewService();
		var overlong = new string('a', UserAccountService.MaxDisplayNameLength + 20);

		var user = await service.SignInAsync(Identity(displayName: overlong), Now);

		Assert.Equal(UserAccountService.MaxDisplayNameLength, user.DisplayName!.Length);
	}

	// ── erasure ──────────────────────────────────────────────────────────────

	[Fact]
	public async Task Deleting_an_account_releases_its_provider_logins()
	{
		var (service, repo) = NewService();
		var created = await service.SignInAsync(Identity(), Now);

		await service.DeleteAccountAsync(created.UserId, Now);

		Assert.Null(await repo.GetUserAsync(created.UserId));
		Assert.Null(await repo.GetIdentityLinkAsync(IdentityKey.For(AuthProviders.Google, "1234567890")));
	}

	[Fact]
	public async Task Deleting_an_account_releases_every_linked_provider_not_just_the_first()
	{
		// A mapping left behind would keep resolving to an account that no longer exists, quietly
		// stranding that login.
		var (service, repo) = NewService();
		var account = await service.SignInAsync(Identity(AuthProviders.Google, "g-1"), Now);
		await service.LinkIdentityAsync(account.UserId, Identity(AuthProviders.Microsoft, "m-1"), Now);

		await service.DeleteAccountAsync(account.UserId, Now);

		Assert.Null(await repo.GetIdentityLinkAsync(IdentityKey.For(AuthProviders.Google, "g-1")));
		Assert.Null(await repo.GetIdentityLinkAsync(IdentityKey.For(AuthProviders.Microsoft, "m-1")));
	}

	[Fact]
	public async Task Signing_in_after_erasure_starts_a_genuinely_new_account()
	{
		// Erasure has to be real: the returning player must not land back on the deleted account.
		var (service, _) = NewService();
		var original = await service.SignInAsync(Identity(), Now);
		await service.DeleteAccountAsync(original.UserId, Now);

		var fresh = await service.SignInAsync(Identity(), Now.AddDays(1));

		Assert.NotEqual(original.UserId, fresh.UserId);
	}

	[Fact]
	public async Task Deleting_an_unknown_account_is_a_no_op()
	{
		// Erasure must be safe to retry after a partial failure.
		var (service, _) = NewService();

		await service.DeleteAccountAsync("never-existed", Now);
	}
}
