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

	/// <summary>Resolve the supported game-content locale, falling back to the public default.</summary>
	public static string NormalizeLanguage(string? value)
	{
		var primary = value?.Trim().Split('-', '_')[0].ToLowerInvariant();
		return primary == "es" ? "es" : "en";
	}

	public static bool IsPlayerCount(int value) => value is >= 2 and <= MaxPlayersPerGame;
}
