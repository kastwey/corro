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

	/// <summary>How long a signed-in session stays valid. Sliding, so an active player is not
	/// signed out mid-campaign, and short enough that an abandoned shared browser does not stay
	/// signed in indefinitely.</summary>
	public int SessionDays { get; init; } = 30;

	/// <summary>Every provider this deployment offers, keyed by the issuer slug used in
	/// <see cref="IdentityKey"/>.</summary>
	public IEnumerable<(string Key, ExternalProviderOptions Options)> ConfiguredProviders()
	{
		if (Google.IsConfigured)
		{
			yield return (AuthProviders.Google, Google);
		}
		if (Microsoft.IsConfigured)
		{
			yield return (AuthProviders.Microsoft, Microsoft);
		}
	}

	/// <summary>Each provider is either untouched or complete; anything between is a
	/// misconfiguration. No provider at all is VALID — it is the "accounts are simply off in this
	/// deployment" state, which must stay a silent, supported configuration.</summary>
	public bool IsValid =>
		(Google.IsEmpty || Google.IsConfigured)
		&& (Microsoft.IsEmpty || Microsoft.IsConfigured)
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
/// The issuer slugs. These strings are PERSISTED inside every identity key, so renaming one would
/// orphan every account that signed in through it — they are storage identifiers, not labels.
/// </summary>
public static class AuthProviders
{
	public const string Google = "google";
	public const string Microsoft = "microsoft";

	/// <summary>The test-only provider the E2E suite signs in with. It exists solely under
	/// <c>ASPNETCORE_ENVIRONMENT=E2E</c>; no production deployment can reach it.</summary>
	public const string E2E = "e2e";
}
