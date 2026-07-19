using CorroServer.Models.Corro;

namespace CorroServer.Models;

/// <summary>
/// Returned when a .corro package is uploaded: a token referencing the staged package (passed
/// when the game is created), the board's localized name (for display), its rule defaults, and the
/// host-customizable rule declarations so the lobby can render the editable ones dynamically.
/// </summary>
public record PackageUploadResponse
{
	public required string Token { get; init; }
	/// <summary>The game family the package targets ("property" | "race"), so the lobby renders
	/// the right rules surface (a race board has no property rules to tweak).</summary>
	public string GameType { get; init; } = "property";
	public required Dictionary<string, string> Name { get; init; }
	public required GameSettings Settings { get; init; }
	/// <summary>Groups for the rules panel (id + i18n name key); empty if the package declares none.</summary>
	public List<RuleGroupDef> RuleGroups { get; init; } = new();
	/// <summary>The host-customizable rule declarations (id, type, default, bounds, group, nameKey).</summary>
	public List<HouseRuleDef> HouseRules { get; init; } = new();
	/// <summary>The package's player tokens (id + inline SVG + i18n name key); empty = built-in set.</summary>
	public List<TokenDef> Tokens { get; init; } = new();
	/// <summary>Fewest players this board can start with (the lobby's start guard mirrors it).</summary>
	public int MinPlayers { get; init; }
	/// <summary>Most players this board supports (the lobby caps the player-count selector at it).</summary>
	public int MaxPlayers { get; init; }
	/// <summary>A race board's seats (squadron colours) so the lobby offers a seat picker;
	/// empty for the property family.</summary>
	public List<LobbySeatInfo> Seats { get; init; } = new();
	/// <summary>
	/// Optional i18n key (in the PACKAGE's own translations) the lobby shows the host as a notice when
	/// they create a game with this board. Null when the package declares none. Carried verbatim — the
	/// engine neither knows nor interprets the text.
	/// </summary>
	public string? Warning { get; init; }
}

/// <summary>A race seat as the lobby needs it: identity, swatch colour and localizable name.</summary>
public record LobbySeatInfo
{
	public required string Id { get; init; }
	public string? Color { get; init; }
	public string? NameKey { get; init; }
}
