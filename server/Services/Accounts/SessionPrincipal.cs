using System.Security.Claims;

namespace CorroServer.Services.Accounts;

/// <summary>
/// Converts between an account and the signed-in principal, independently of how that principal is
/// carried. Today the carrier is a cookie; a native app will later carry a bearer token. Both need
/// exactly this mapping, so it lives on its own rather than inside the cookie wiring.
///
/// The principal holds ONLY the account id. Everything else a caller might want — display name,
/// address, linked providers — is read from the account document at request time, so a renamed
/// account is correct immediately instead of after the session expires, and the credential stays
/// small enough to be uninteresting if it ever leaks.
/// </summary>
public static class SessionPrincipal
{
	/// <summary>Identity type recorded on the principal, so a session issued by this app is
	/// distinguishable from one minted by a provider handler.</summary>
	public const string AuthenticationType = "Corro";

	public static ClaimsPrincipal For(string userId)
	{
		var identity = new ClaimsIdentity(
			new[] { new Claim(ClaimTypes.NameIdentifier, userId) },
			AuthenticationType);
		return new ClaimsPrincipal(identity);
	}

	/// <summary>The signed-in account id, or null when the principal is anonymous. Anonymous is a
	/// normal, fully supported state — most players never sign in.</summary>
	public static string? UserId(ClaimsPrincipal? principal)
	{
		var value = principal?.FindFirstValue(ClaimTypes.NameIdentifier);
		return string.IsNullOrWhiteSpace(value) ? null : value;
	}
}

/// <summary>
/// Reads the identity a provider asserted out of the principal its handler produced.
/// </summary>
public static class ExternalLogin
{
	/// <summary>
	/// The (issuer, subject) identity plus profile decoration, or null when the provider returned no
	/// subject. A missing subject is not recoverable — without it there is nothing stable to bind an
	/// account to — so callers must treat null as a failed sign-in rather than inventing an id.
	/// </summary>
	public static ExternalIdentity? FromPrincipal(ClaimsPrincipal? principal, string issuer)
	{
		if (principal is null)
		{
			return null;
		}

		var subject = principal.FindFirstValue(ClaimTypes.NameIdentifier);
		if (string.IsNullOrWhiteSpace(subject))
		{
			return null;
		}

		return new ExternalIdentity(
			Issuer: issuer,
			Subject: subject,
			DisplayName: principal.FindFirstValue(ClaimTypes.Name),
			Email: principal.FindFirstValue(ClaimTypes.Email),
			// OIDC's own flag for "we checked this address". Absent means no: an address nobody
			// vouched for is not one to act on.
			EmailVerified: string.Equals(
				principal.FindFirstValue("email_verified"), "true", StringComparison.OrdinalIgnoreCase));
	}
}
