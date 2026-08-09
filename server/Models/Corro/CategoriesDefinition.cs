namespace CorroServer.Models.Corro;

// The categories family has no spatial board and no hand. A package supplies one real deck per
// locale (categories.<locale>.json): the category prompts everyone writes to, and the letters
// they can be dealt. Both are language-split CONTENT — the alphabet itself differs by language
// (Spanish has Ñ and no practical K or W; English has no useful Q or X) — so the host selects
// exactly one deck at start while every player's interface stays in their own locale.

/// <summary>One category prompt, in one content language.</summary>
public sealed record CategoryDef
{
	/// <summary>Stable package-owned identifier. It is never used as player-facing text.</summary>
	public string Id { get; init; } = string.Empty;

	/// <summary>The prompt as the table reads it ("A fruit", "Something you take to the beach").</summary>
	public string Name { get; init; } = string.Empty;
}

/// <summary>One locale's categories deck: the prompts and the letters that can be drawn.</summary>
public sealed record CategoryDeckDef
{
	/// <summary>The letters this language can fairly ask for. Single characters, no duplicates.</summary>
	public List<string> Letters { get; init; } = new();

	public List<CategoryDef> Categories { get; init; } = new();
}

/// <summary>Family rules from manifest <c>categoriesRules</c>.</summary>
public sealed record CategoriesRulesConfig
{
	/// <summary>Authoritative duration of the writing phase of each round.</summary>
	public int RoundSeconds { get; init; } = 120;

	/// <summary>How many categories are dealt per round.</summary>
	public int CategoriesPerRound { get; init; } = 6;

	/// <summary>Points earned for each answer the judge accepts.</summary>
	public int PointsPerAnswer { get; init; } = 1;

	/// <summary>Complete judge rotations every player must take before scores decide the game.
	/// A tie automatically adds another complete rotation.</summary>
	public int Cycles { get; init; } = 1;
}
