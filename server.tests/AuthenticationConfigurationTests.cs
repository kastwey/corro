using System.Security.Claims;
using CorroServer.Services.Accounts;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The transport-independent seam between an account and a signed-in caller, plus the deployment
/// configuration that decides which providers exist at all.
/// </summary>
public class SessionPrincipalTests
{
	[Fact]
	public void A_session_principal_round_trips_the_account_id()
	{
		var principal = SessionPrincipal.For("user-42");

		Assert.Equal("user-42", SessionPrincipal.UserId(principal));
	}

	[Fact]
	public void A_session_principal_carries_only_the_account_id()
	{
		// Everything else is read from the account document per request, so a renamed account is
		// correct immediately and the credential stays uninteresting if it leaks.
		var principal = SessionPrincipal.For("user-42");

		Assert.Single(principal.Claims);
	}

	[Fact]
	public void An_anonymous_caller_has_no_account_id()
	{
		// Not being signed in is an ordinary state, so this must answer null rather than throw.
		Assert.Null(SessionPrincipal.UserId(new ClaimsPrincipal(new ClaimsIdentity())));
		Assert.Null(SessionPrincipal.UserId(null));
	}
}

/// <summary>Reading the identity a provider asserted out of its handler's principal.</summary>
public class ExternalLoginTests
{
	private static ClaimsPrincipal PrincipalWith(params Claim[] claims) =>
		new(new ClaimsIdentity(claims, "TestProvider"));

	[Fact]
	public void Reads_the_subject_name_and_email()
	{
		var principal = PrincipalWith(
			new Claim(ClaimTypes.NameIdentifier, "1234567890"),
			new Claim(ClaimTypes.Name, "Ana"),
			new Claim(ClaimTypes.Email, "ana@example.com"));

		var identity = ExternalLogin.FromPrincipal(principal, AuthProviders.Google);

		Assert.NotNull(identity);
		Assert.Equal(AuthProviders.Google, identity.Issuer);
		Assert.Equal("1234567890", identity.Subject);
		Assert.Equal("Ana", identity.DisplayName);
		Assert.Equal("ana@example.com", identity.Email);
	}

	[Fact]
	public void A_provider_that_returns_no_subject_yields_no_identity()
	{
		// Without a subject there is nothing stable to bind an account to. Falling back to the email
		// here would reintroduce exactly the address-based matching the design rules out.
		var principal = PrincipalWith(new Claim(ClaimTypes.Email, "ana@example.com"));

		Assert.Null(ExternalLogin.FromPrincipal(principal, AuthProviders.Google));
	}

	[Fact]
	public void A_missing_principal_yields_no_identity()
	{
		Assert.Null(ExternalLogin.FromPrincipal(null, AuthProviders.Google));
	}

	[Fact]
	public void A_profile_without_a_name_or_email_still_signs_in()
	{
		// Both are optional decoration; only the subject is required.
		var principal = PrincipalWith(new Claim(ClaimTypes.NameIdentifier, "1234567890"));

		var identity = ExternalLogin.FromPrincipal(principal, AuthProviders.Microsoft);

		Assert.NotNull(identity);
		Assert.Null(identity.DisplayName);
		Assert.Null(identity.Email);
	}
}

/// <summary>
/// Provider configuration. The shape mirrors the voice options: absent means off, complete means on,
/// and anything in between fails startup instead of shipping a button that dead-ends.
/// </summary>
public class ExternalAuthOptionsTests
{
	[Fact]
	public void No_configuration_at_all_is_valid_and_offers_nothing()
	{
		var options = new ExternalAuthOptions();

		Assert.True(options.IsValid);
		Assert.Empty(options.ConfiguredProviders());
	}

	[Fact]
	public void A_fully_configured_provider_is_offered()
	{
		var options = new ExternalAuthOptions
		{
			Google = new ExternalProviderOptions { ClientId = "id", ClientSecret = "secret" },
		};

		Assert.True(options.IsValid);
		var provider = Assert.Single(options.ConfiguredProviders());
		Assert.Equal(AuthProviders.Google, provider.Key);
	}

	[Theory]
	[InlineData("id", null)]
	[InlineData(null, "secret")]
	[InlineData("id", "   ")]
	public void A_half_configured_provider_is_invalid(string? clientId, string? clientSecret)
	{
		// Failing startup is the point: a half-filled section otherwise renders a sign-in button
		// whose only possible outcome is a provider error page.
		var options = new ExternalAuthOptions
		{
			Google = new ExternalProviderOptions { ClientId = clientId, ClientSecret = clientSecret },
		};

		Assert.False(options.IsValid);
	}

	[Fact]
	public void One_configured_provider_does_not_invalidate_an_untouched_one()
	{
		var options = new ExternalAuthOptions
		{
			Google = new ExternalProviderOptions { ClientId = "id", ClientSecret = "secret" },
		};

		Assert.True(options.IsValid);
		Assert.Single(options.ConfiguredProviders());
	}

	[Theory]
	[InlineData(0)]
	[InlineData(366)]
	public void An_out_of_range_session_lifetime_is_invalid(int days)
	{
		Assert.False(new ExternalAuthOptions { SessionDays = days }.IsValid);
	}

	[Fact]
	public void Provider_slugs_are_valid_identity_key_issuers()
	{
		// The slugs are persisted inside every identity key, so they must satisfy the key's own rules.
		foreach (var (key, _) in new ExternalAuthOptions
		{
			Google = new ExternalProviderOptions { ClientId = "id", ClientSecret = "secret" },
			Microsoft = new ExternalProviderOptions { ClientId = "id", ClientSecret = "secret" },
		}.ConfiguredProviders())
		{
			Assert.Equal($"{key}:sub", IdentityKey.For(key, "sub"));
		}
	}
}

/// <summary>The catalog the client's buttons and the sign-in route both read from.</summary>
public class AuthProviderCatalogTests
{
	[Fact]
	public void An_empty_catalog_means_accounts_are_unavailable()
	{
		// A deployment with no provider configured must stay fully playable, so this is a supported
		// state rather than a misconfiguration.
		var catalog = new AuthProviderCatalog(Array.Empty<AuthProviderDescriptor>());

		Assert.Empty(catalog.Providers);
		Assert.Null(catalog.Find(AuthProviders.Google));
	}

	[Fact]
	public void Finds_a_configured_provider_and_rejects_anything_else()
	{
		// The route validates against this same catalog, so an unlisted provider can never be
		// challenged even if a client asks for it by name.
		var catalog = new AuthProviderCatalog(
			new[] { new AuthProviderDescriptor(AuthProviders.Google, IsTestDouble: false) });

		Assert.NotNull(catalog.Find(AuthProviders.Google));
		Assert.Null(catalog.Find(AuthProviders.Microsoft));
		Assert.Null(catalog.Find("GOOGLE"));
	}

	[Fact]
	public void The_test_double_is_never_part_of_a_configured_deployment()
	{
		// The E2E stand-in completes a sign-in without any provider, so it may only ever come from
		// the E2E-only registration — never from configuration.
		var options = new ExternalAuthOptions
		{
			Google = new ExternalProviderOptions { ClientId = "id", ClientSecret = "secret" },
			Microsoft = new ExternalProviderOptions { ClientId = "id", ClientSecret = "secret" },
		};

		Assert.DoesNotContain(options.ConfiguredProviders(), p => p.Key == AuthProviders.E2E);
	}
}
