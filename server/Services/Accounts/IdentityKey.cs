using System.Security.Cryptography;
using System.Text;

namespace CorroServer.Services.Accounts;

/// <summary>
/// Builds the composite key that identifies an external login: <c>"{issuer}:{subject}"</c>.
///
/// This key is the whole basis of "who is this person", so it has exactly one job — map distinct
/// (issuer, subject) pairs to distinct strings, and identical pairs to identical strings. It also
/// has to survive being used verbatim as a Cosmos item id.
///
/// Real provider subjects are already tame: Google's are decimal digits, Microsoft's and Apple's are
/// base64url. So the key keeps them AS THEY ARE, which is worth a lot when reading the database by
/// eye. A subject outside that safe alphabet is not escaped but replaced wholesale by a hash, marked
/// with a '~' the safe alphabet cannot produce. Escaping was the obvious alternative and is a trap:
/// percent-escapes make ids that Cosmos stores but cannot read back.
///
/// Subjects are opaque and CASE-SENSITIVE — lower-casing one could merge two different people onto a
/// single account — so nothing here normalizes them.
/// </summary>
public static class IdentityKey
{
	/// <summary>Marks a hashed subject. Excluded from <see cref="IsSafeSubjectChar"/>, so a literal
	/// subject can never be mistaken for a hashed one.</summary>
	private const char HashMarker = '~';

	/// <summary>
	/// The storage key for an external login. Throws when either part is missing or the issuer is
	/// not a plain lowercase slug — a malformed identity must fail loudly rather than silently
	/// produce a key that could collide with another provider's.
	/// </summary>
	public static string For(string issuer, string subject)
	{
		ArgumentException.ThrowIfNullOrWhiteSpace(issuer);
		ArgumentException.ThrowIfNullOrWhiteSpace(subject);

		if (!IsSlug(issuer))
		{
			throw new ArgumentException(
				$"Issuer '{issuer}' must be a lowercase slug (a-z, 0-9 and '-', starting with a letter or digit).",
				nameof(issuer));
		}

		return $"{issuer}:{EncodeSubject(subject)}";
	}

	/// <summary>Lowercase letters, digits and '-', never starting with '-'. Keeping the issuer to
	/// this alphabet is what guarantees the ':' delimiter is unambiguous.</summary>
	public static bool IsSlug(string value) =>
		value.Length > 0
		&& value[0] != '-'
		&& value.All(c => c is >= 'a' and <= 'z' or >= '0' and <= '9' or '-');

	private static string EncodeSubject(string subject)
	{
		if (subject.All(IsSafeSubjectChar))
		{
			return subject;
		}

		// A hash rather than an escape: it is fixed-length, contains only base64url characters, and
		// stays injective for practical purposes. The raw subject is still stored in the account
		// document, so nothing is actually lost.
		var digest = SHA256.HashData(Encoding.UTF8.GetBytes(subject));
		return HashMarker + Base64Url(digest);
	}

	/// <summary>The alphabet every real provider subject already uses, and which is safe both in a
	/// Cosmos id and in a URL.</summary>
	private static bool IsSafeSubjectChar(char c) =>
		c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '.' or '_' or '-';

	private static string Base64Url(byte[] bytes) =>
		Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
