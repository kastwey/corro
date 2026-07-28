using CorroServer.Services.Accounts;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The composite key that decides WHO a provider login belongs to. Its only real obligation is
/// injectivity — distinct (issuer, subject) pairs must never collide, because a collision would put
/// two different people on one account — so most of these tests are about the ways a naive
/// concatenation would break that.
/// </summary>
public class IdentityKeyTests
{
	[Fact]
	public void Builds_the_issuer_and_subject_pair()
	{
		Assert.Equal("google:1234567890", IdentityKey.For("google", "1234567890"));
	}

	[Fact]
	public void Same_subject_from_different_providers_stays_distinct()
	{
		// Providers each mint their own subject namespace: the same string from two of them is two
		// different people, and merging them would hand one account to the other.
		Assert.NotEqual(
			IdentityKey.For(AuthProviders.Google, "1234567890"),
			IdentityKey.For(AuthProviders.Microsoft, "1234567890"));
	}

	[Fact]
	public void Subject_case_is_preserved()
	{
		// Microsoft subjects are base64url, where case is significant. Normalizing it would fold two
		// distinct accounts together.
		Assert.NotEqual(IdentityKey.For("microsoft", "AbC123"), IdentityKey.For("microsoft", "abc123"));
	}

	[Theory]
	// Characters that are illegal in a Cosmos item id, plus '%', which Cosmos accepts on write but
	// then cannot read the item back by. None of them may reach an id in any form — not raw, and
	// not percent-escaped either.
	[InlineData("a/b")]
	[InlineData("a\\b")]
	[InlineData("a?b")]
	[InlineData("a#b")]
	[InlineData("a%b")]
	[InlineData("a b")]
	public void An_awkward_subject_produces_an_id_safe_alphabet_key(string subject)
	{
		var key = IdentityKey.For("google", subject);
		var encoded = key["google:".Length..];

		Assert.StartsWith("~", encoded);
		Assert.All(encoded[1..], c =>
			Assert.True(char.IsAsciiLetterOrDigit(c) || c is '-' or '_', $"unexpected character '{c}'"));
	}

	[Fact]
	public void Hashing_an_awkward_subject_is_stable()
	{
		// The key is the account's lookup: a subject that hashed differently between two sign-ins
		// would strand the player behind a new account each time.
		Assert.Equal(IdentityKey.For("google", "a/b"), IdentityKey.For("google", "a/b"));
	}

	[Fact]
	public void Two_different_awkward_subjects_do_not_collide()
	{
		Assert.NotEqual(IdentityKey.For("google", "a/b"), IdentityKey.For("google", "a?b"));
	}

	[Fact]
	public void A_hashed_subject_cannot_collide_with_a_literal_one()
	{
		// The '~' marker is outside the safe alphabet, so no untouched subject can imitate a hash.
		var hashed = IdentityKey.For("google", "a/b")["google:".Length..];

		Assert.Equal(hashed, IdentityKey.For("google", "a/b")["google:".Length..]);
		Assert.NotEqual(hashed, IdentityKey.For("google", hashed)["google:".Length..]);
	}

	[Fact]
	public void Control_characters_are_encoded()
	{
		// Cosmos ids must stay printable, so a stray control character cannot travel through raw.
		var subject = "a" + (char)1 + "b";

		var key = IdentityKey.For("google", subject);

		Assert.StartsWith("google:~", key);
	}

	[Theory]
	// The shapes real providers actually issue: Google's decimal ids and Microsoft's base64url ones.
	// These must stay readable in the database, which is worth a lot when debugging.
	[InlineData("108245712349871234098")]
	[InlineData("AAAAAAAAAAAAAAAAAAAAAJ1_x-yZ.wQ")]
	public void A_normal_provider_subject_is_left_alone(string subject)
	{
		Assert.Equal($"google:{subject}", IdentityKey.For("google", subject));
	}

	[Theory]
	[InlineData("Google")]     // uppercase would make "Google:x" and "google:x" two accounts
	[InlineData("goo gle")]
	[InlineData("goo:gle")]    // would make the issuer/subject split ambiguous
	[InlineData("-google")]
	[InlineData("googlé")]
	public void Rejects_an_issuer_that_is_not_a_plain_slug(string issuer)
	{
		Assert.Throws<ArgumentException>(() => IdentityKey.For(issuer, "subject"));
	}

	[Theory]
	[InlineData("")]
	[InlineData("   ")]
	public void Rejects_a_missing_subject(string subject)
	{
		// No subject means the provider told us nothing stable to bind to; inventing one would
		// silently create a new account on every sign-in.
		Assert.Throws<ArgumentException>(() => IdentityKey.For("google", subject));
	}

	[Fact]
	public void Accepts_the_shipped_provider_slugs()
	{
		Assert.True(IdentityKey.IsSlug(AuthProviders.Google));
		Assert.True(IdentityKey.IsSlug(AuthProviders.Microsoft));
		Assert.True(IdentityKey.IsSlug(AuthProviders.E2E));
	}
}
