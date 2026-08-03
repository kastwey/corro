using System.Text.RegularExpressions;

namespace CorroServer.Services.Accounts;

/// <summary>
/// The public name a player chooses to be found by — "@kastwey" — as opposed to the display name,
/// which is seeded from the provider profile and is usually somebody's real name.
///
/// The character set is deliberately narrow: ASCII letters, digits and underscore, starting with a
/// letter. That is not tidiness, it is the impersonation defence. A wider set means homoglyphs —
/// "@kаstwey" with a Cyrillic а reads and looks identical — and in an app built for people who
/// cannot SEE the difference, a name that can be forged visually is a name that cannot be trusted.
/// Restricting the alphabet removes the whole class of attack without a confusables table to
/// maintain, at the price of accents: Núria's tildes belong in her display name, which is where
/// they are read properly anyway.
///
/// Stored as typed and compared in lower case, so "@Kastwey" shows as chosen while "kastwey" is
/// the key nobody else can take.
/// </summary>
public static class PlayerHandle
{
	public const int MinLength = 3;
	public const int MaxLength = 20;

	/// <summary>How long a player must wait before changing again. A handle other people learn is
	/// only useful if it holds still.</summary>
	public static readonly TimeSpan ChangeInterval = TimeSpan.FromDays(30);

	/// <summary>How long an abandoned handle stays untakeable. Without it, a handle released today
	/// and grabbed this afternoon is clean impersonation: the same name, a different person, and
	/// nobody the wiser.</summary>
	public static readonly TimeSpan ReleaseCooldown = TimeSpan.FromDays(30);

	private static readonly Regex Allowed = new("^[a-zA-Z][a-zA-Z0-9_]*$", RegexOptions.Compiled);

	/// <summary>
	/// Names the product speaks with, or that would let somebody pass for the service itself.
	/// Matched on the normalized form, so "@Admin" and "@admin" are the same refusal.
	/// </summary>
	private static readonly HashSet<string> Reserved = new(StringComparer.Ordinal)
	{
		"admin", "administrator", "root", "system", "support", "help", "staff", "moderator", "mod",
		"corro", "allwelcome", "official", "team", "security", "abuse", "billing", "noreply",
		"me", "you", "everyone", "anyone", "nobody", "null", "undefined", "deleted", "unknown",
		"bot", "server", "host", "guest", "anonymous",
	};

	/// <summary>Why a handle was refused. The caller turns this into words the player reads.</summary>
	public enum Rejection
	{
		None,
		TooShort,
		TooLong,
		BadCharacters,
		Reserved,
	}

	/// <summary>The comparison key: lower case, nothing else. The alphabet is already narrow enough
	/// that no further folding is needed — which is the point of choosing it.</summary>
	public static string Normalize(string handle) => (handle ?? string.Empty).Trim().ToLowerInvariant();

	/// <summary>Check a handle before anything is stored. <see cref="Rejection.None"/> means usable.</summary>
	public static Rejection Validate(string? handle)
	{
		var trimmed = (handle ?? string.Empty).Trim();
		if (trimmed.Length < MinLength) return Rejection.TooShort;
		if (trimmed.Length > MaxLength) return Rejection.TooLong;
		// Checked after length so "" reports "too short" rather than the less helpful "bad characters".
		if (!Allowed.IsMatch(trimmed)) return Rejection.BadCharacters;
		if (Reserved.Contains(Normalize(trimmed))) return Rejection.Reserved;
		return Rejection.None;
	}

	/// <summary>
	/// Whether a claim standing in the way can be taken over. A claim still held by its owner never
	/// can; a released one only once its cooldown has passed — except by the person who released
	/// it, because taking your own name back is not impersonating anybody.
	/// </summary>
	public static bool CanTakeOver(HandleClaim existing, string byUserId, DateTime utcNow)
	{
		if (existing.UserId == byUserId) return true;
		if (existing.ReleasedAtUtc is not { } released) return false;
		return utcNow - released >= ReleaseCooldown;
	}

	/// <summary>Whether this player may change their handle now.</summary>
	public static bool CanChange(DateTime? lastChangedUtc, DateTime utcNow) =>
		lastChangedUtc is not { } last || utcNow - last >= ChangeInterval;
}

/// <summary>The parts of a stored claim the rules above reason about, so they stay testable
/// without a repository.</summary>
public readonly record struct HandleClaim(string UserId, DateTime? ReleasedAtUtc);
