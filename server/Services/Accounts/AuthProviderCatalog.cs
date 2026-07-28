namespace CorroServer.Services.Accounts;

/// <summary>One sign-in option this deployment offers.</summary>
/// <param name="Key">The issuer slug, also the value in the sign-in route.</param>
/// <param name="IsTestDouble">True only for the E2E stand-in, which completes a sign-in locally
/// instead of redirecting to a real provider. Always false in production.</param>
public sealed record AuthProviderDescriptor(string Key, bool IsTestDouble);

/// <summary>
/// Which sign-in providers exist right now. It is the single answer to that question for both the
/// public <c>/api/auth/providers</c> endpoint and the sign-in route's validation, so the client can
/// never be shown a button that the server would then reject.
///
/// A deployment with no provider configured yields an EMPTY catalog, which is a fully supported
/// state: accounts are simply unavailable and everything account-less keeps working.
/// </summary>
public class AuthProviderCatalog
{
	public AuthProviderCatalog(IEnumerable<AuthProviderDescriptor> providers)
	{
		Providers = providers.ToList();
	}

	public IReadOnlyList<AuthProviderDescriptor> Providers { get; }

	public AuthProviderDescriptor? Find(string key) =>
		Providers.FirstOrDefault(p => string.Equals(p.Key, key, StringComparison.Ordinal));
}
