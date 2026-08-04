using CorroServer.Models;
using CorroServer.Services.Accounts;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Integration tests for <see cref="CosmosUserRepository"/> against the local Cosmos emulator.
/// Gated by <see cref="CosmosFactAttribute"/>, so they run locally with the emulator up and are
/// skipped — never failed — in CI.
///
/// The one behaviour that CANNOT be proven against the in-memory double is the first-sign-in race
/// guard: in memory it is a ConcurrentDictionary, in Cosmos it is the server rejecting a duplicate
/// id. These tests exist mainly to confirm the real store enforces it.
/// </summary>
public class CosmosUserRepositoryIntegrationTests
{
	private static readonly DateTime Now = new(2026, 7, 26, 12, 0, 0, DateTimeKind.Utc);

	private static Task<CosmosUserRepository> NewRepositoryAsync() => Emulators.NewCosmosUserRepositoryAsync();

	private static string UniqueSubject() => "itest-" + Guid.NewGuid().ToString("N")[..12];

	private static UserDocument NewUser(string userId, string subject) => new()
	{
		Id = userId,
		UserId = userId,
		DisplayName = "Ana",
		Email = "ana@example.com",
		CreatedAtUtc = Now,
		LastSignInUtc = Now,
		Identities =
		{
			new LinkedIdentity
			{
				Issuer = AuthProviders.Google,
				Subject = subject,
				Email = "ana@example.com",
				LinkedAtUtc = Now,
			},
		},
	};

	[CosmosFact]
	public async Task An_account_round_trips_through_storage()
	{
		var repo = await NewRepositoryAsync();
		var userId = Guid.NewGuid().ToString();
		var subject = UniqueSubject();

		await repo.UpsertUserAsync(NewUser(userId, subject));
		var loaded = await repo.GetUserAsync(userId);

		Assert.NotNull(loaded);
		Assert.Equal("Ana", loaded.DisplayName);
		Assert.Equal("ana@example.com", loaded.Email);
		var identity = Assert.Single(loaded.Identities);
		Assert.Equal(subject, identity.Subject);
		Assert.Equal(AuthProviders.Google, identity.Issuer);

		await repo.DeleteUserAsync(userId);
		Assert.Null(await repo.GetUserAsync(userId));
	}

	[CosmosFact]
	public async Task An_unknown_account_reads_as_null_rather_than_throwing()
	{
		var repo = await NewRepositoryAsync();

		Assert.Null(await repo.GetUserAsync(Guid.NewGuid().ToString()));
		Assert.Null(await repo.GetIdentityLinkAsync(IdentityKey.For(AuthProviders.Google, UniqueSubject())));
	}

	[CosmosFact]
	public async Task Creating_an_identity_link_twice_keeps_the_first_writer()
	{
		// The real race guard: Cosmos rejects the duplicate id, and the loser must receive the
		// STORED document so it adopts the winner's account instead of creating a second one.
		var repo = await NewRepositoryAsync();
		var key = IdentityKey.For(AuthProviders.Google, UniqueSubject());

		var first = await repo.CreateOrGetIdentityLinkAsync(new IdentityLinkDocument
		{
			Id = key,
			IdentityKey = key,
			UserId = "first-writer",
			CreatedAtUtc = Now,
		});

		var second = await repo.CreateOrGetIdentityLinkAsync(new IdentityLinkDocument
		{
			Id = key,
			IdentityKey = key,
			UserId = "second-writer",
			CreatedAtUtc = Now.AddSeconds(1),
		});

		Assert.Equal("first-writer", first.UserId);
		Assert.Equal("first-writer", second.UserId);

		await repo.DeleteIdentityLinkAsync(key);
	}

	[CosmosFact]
	public async Task Concurrent_first_sign_ins_through_the_real_store_create_one_account()
	{
		// The end-to-end version of the guard, driven through the sign-in policy rather than the
		// repository, because that is the path a real double-submitted login takes.
		var repo = await NewRepositoryAsync();
		var service = new UserAccountService(repo, NullLogger<UserAccountService>.Instance);
		var identity = new ExternalIdentity(AuthProviders.Google, UniqueSubject(), "Ana", "ana@example.com");

		var results = await Task.WhenAll(
			Enumerable.Range(0, 6).Select(_ => service.SignInAsync(identity, Now)));

		var userId = Assert.Single(results.Select(u => u.UserId).Distinct());

		await service.DeleteAccountAsync(userId, DateTime.UtcNow);
		Assert.Null(await repo.GetIdentityLinkAsync(IdentityKey.For(identity.Issuer, identity.Subject)));
	}

	[CosmosFact]
	public async Task A_subject_containing_a_character_illegal_in_an_id_is_still_storable()
	{
		// Provider subjects are opaque. The key encoding exists so one containing '/' cannot make
		// storage reject the account outright.
		var repo = await NewRepositoryAsync();
		var key = IdentityKey.For(AuthProviders.Microsoft, UniqueSubject() + "/a?b#c");

		var stored = await repo.CreateOrGetIdentityLinkAsync(new IdentityLinkDocument
		{
			Id = key,
			IdentityKey = key,
			UserId = "user-with-awkward-subject",
			CreatedAtUtc = Now,
		});

		Assert.Equal("user-with-awkward-subject", stored.UserId);
		Assert.NotNull(await repo.GetIdentityLinkAsync(key));

		await repo.DeleteIdentityLinkAsync(key);
	}

	[CosmosFact]
	public async Task Deleting_something_that_is_already_gone_succeeds()
	{
		// Erasure has to be safe to retry after a partial failure.
		var repo = await NewRepositoryAsync();

		await repo.DeleteUserAsync(Guid.NewGuid().ToString());
		await repo.DeleteIdentityLinkAsync(IdentityKey.For(AuthProviders.Google, UniqueSubject()));
	}
}
