namespace CorroServer.Services;

/// <summary>Small, transport-independent validation rules for untrusted lobby requests.</summary>
public static class LobbyInput
{
	public const int MaxPlayerNameLength = 20;
	public const int MaxDisplayNameLength = 160;
	public const int MaxIdentifierLength = 128;
	public const int MaxPlayersPerGame = 16;

	public static bool TryNormalizePlayerName(string? value, out string normalized)
	{
		normalized = value?.Trim() ?? string.Empty;
		return normalized.Length is > 0 and <= MaxPlayerNameLength
			&& !normalized.Any(char.IsControl);
	}

	public static bool IsIdentifier(string? value, bool optional = false)
	{
		if (value is null)
		{
			return optional;
		}

		return value.Length is > 0 and <= MaxIdentifierLength
			&& value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
	}

	/// <summary>Normalize bounded human-readable labels, which may contain Unicode, spaces,
	/// and punctuation but never control characters. Board names are display text, not ids.</summary>
	public static bool TryNormalizeDisplayName(string? value, out string normalized)
	{
		normalized = value?.Trim() ?? string.Empty;
		return normalized.Length is > 0 and <= MaxDisplayNameLength
			&& !normalized.Any(char.IsControl);
	}

	/// <summary>Try to resolve one of the application-supported primary locales.</summary>
	public static bool TryNormalizeLanguage(string? value, out string normalized)
	{
		var primary = value?.Trim().Split('-', '_')[0].ToLowerInvariant();
		normalized = primary == "es" ? "es" : "en";
		return primary is "en" or "es";
	}

	/// <summary>Resolve the supported game-content locale, falling back to the public default.</summary>
	public static string NormalizeLanguage(string? value)
		=> TryNormalizeLanguage(value, out var normalized) ? normalized : "en";

	/// <summary>Match an untrusted requested locale to an explicit package-owned language list.
	/// The returned value is the package's canonical spelling, which is also its deck key.</summary>
	public static bool TrySelectLanguage(
		IEnumerable<string> available,
		string? requested,
		out string selected)
	{
		selected = string.Empty;
		if (!TryNormalizeLanguage(requested, out var normalized))
		{
			return false;
		}

		var match = available.FirstOrDefault(candidate =>
			TryNormalizeLanguage(candidate, out var candidateLanguage)
			&& candidateLanguage == normalized);
		if (match is null)
		{
			return false;
		}

		selected = match;
		return true;
	}

	public static bool IsPlayerCount(int value) => value is >= 2 and <= MaxPlayersPerGame;
}
