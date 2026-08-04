namespace CorroServer.Services.Accounts;

/// <summary>
/// Deployment configuration for optional external sign-in. Mirrors
/// <see cref="Voice.LiveKitOptions"/>: an entirely empty provider section keeps that provider off,
/// while a HALF-filled one fails startup rather than shipping a sign-in button that dead-ends on a
/// provider error. Client secrets never leave the server — the client only ever learns which
/// providers are available.
/// </summary>
public sealed class ExternalAuthOptions
{
	public const string SectionName = "Authentication";

	public ExternalProviderOptions Google { get; init; } = new();
	public ExternalProviderOptions Microsoft { get; init; } = new();
	public AppleProviderOptions Apple { get; init; } = new();

	/// <summary>How long a signed-in session stays valid. Sliding, so an active player is not
	/// signed out mid-campaign, and short enough that an abandoned shared browser does not stay
	/// signed in indefinitely.</summary>
	public int SessionDays { get; init; } = 30;

	/// <summary>Every provider this deployment offers, keyed by the issuer slug used in
	/// <see cref="IdentityKey"/>.</summary>
	public IEnumerable<string> ConfiguredProviders()
	{
		if (Google.IsConfigured)
		{
			yield return AuthProviders.Google;
		}
		if (Microsoft.IsConfigured)
		{
			yield return AuthProviders.Microsoft;
		}
		if (Apple.IsConfigured)
		{
			yield return AuthProviders.Apple;
		}
	}

	/// <summary>Each provider is either untouched or complete; anything between is a
	/// misconfiguration. No provider at all is VALID — it is the "accounts are simply off in this
	/// deployment" state, which must stay a silent, supported configuration.</summary>
	public bool IsValid =>
		(Google.IsEmpty || Google.IsConfigured)
		&& (Microsoft.IsEmpty || Microsoft.IsConfigured)
		&& (Apple.IsEmpty || Apple.IsConfigured)
		&& SessionDays is >= 1 and <= 365;
}

/// <summary>Credentials for one OAuth provider.</summary>
public sealed class ExternalProviderOptions
{
	public string? ClientId { get; init; }
	public string? ClientSecret { get; init; }

	public bool IsEmpty =>
		string.IsNullOrWhiteSpace(ClientId) && string.IsNullOrWhiteSpace(ClientSecret);

	public bool IsConfigured =>
		!string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}

/// <summary>
/// Credentials for Sign in with Apple. Unlike the others, Apple's "secret" is not a string but
/// a short-lived ES256 JWT the handler mints from these four values, so this holds what signing
/// needs - the Services ID (ClientId), Team ID, Key ID and the .p8 private key - instead of a
/// ClientSecret. The PEM never ships in the repo: supply it as a secret (user-secrets in dev, an
/// environment variable or a vault in prod).
/// </summary>
public sealed class AppleProviderOptions
{
	/// <summary>The Services ID registered for web auth (e.g. games.allwelcome.web).</summary>
	public string? ClientId { get; init; }

	/// <summary>The ten-character Apple Team ID.</summary>
	public string? TeamId { get; init; }

	/// <summary>The Key ID of the .p8 Sign in with Apple key.</summary>
	public string? KeyId { get; init; }

	/// <summary>The PEM body of the .p8 private key, including its BEGIN/END lines.</summary>
	public string? PrivateKey { get; init; }

	public bool IsEmpty =>
		string.IsNullOrWhiteSpace(ClientId) && string.IsNullOrWhiteSpace(TeamId)
		&& string.IsNullOrWhiteSpace(KeyId) && string.IsNullOrWhiteSpace(PrivateKey);

	/// <summary>Either untouched or complete; a half-filled one fails startup rather than shipping
	/// a dead sign-in button, exactly like <see cref="ExternalProviderOptions"/>.</summary>
	public bool IsConfigured =>
		!string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(TeamId)
		&& !string.IsNullOrWhiteSpace(KeyId) && !string.IsNullOrWhiteSpace(PrivateKey);
}

/// <summary>
/// The issuer slugs. These strings are PERSISTED inside every identity key, so renaming one would
/// orphan every account that signed in through it — they are storage identifiers, not labels.
/// </summary>
public static class AuthProviders
{
	public const string Google = "google";
	public const string Microsoft = "microsoft";
	public const string Apple = "apple";

	/// <summary>The test-only provider the E2E suite signs in with. It exists solely under
	/// <c>ASPNETCORE_ENVIRONMENT=E2E</c>; no production deployment can reach it.</summary>
	public const string E2E = "e2e";
}
