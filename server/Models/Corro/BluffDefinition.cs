namespace CorroServer.Models.Corro;

// The bluff family has no spatial board, no hand and no pieces. A package supplies one real deck
// per locale (truths.<locale>.json): the questions everybody bluffs about and the truth that
// hides among the bluffs. Both are language-split CONTENT, so the host selects exactly one deck at
// start while every player's interface stays in their own locale.

/// <summary>One question with its true answer, in one content language.</summary>
public sealed record BluffQuestionDef
{
	/// <summary>Stable package-owned identifier. It is never used as player-facing text.</summary>
	public string Id { get; init; } = string.Empty;

	/// <summary>The question as the table reads it, with a blank to fill where the deck wants one.</summary>
	public string Question { get; init; } = string.Empty;

	/// <summary>The true answer, as it is revealed. It is also what a bluff must NOT be: a player
	/// who writes it by accident is asked for another.</summary>
	public string Truth { get; init; } = string.Empty;

	/// <summary>Other spellings or wordings of the truth. A bluff normalizing to any of them is
	/// refused like the truth itself, so "cuarenta y dos" cannot sit beside "42" as a lie.</summary>
	public List<string> AlsoTrue { get; init; } = new();
}

/// <summary>Family rules from manifest <c>bluffRules</c>.</summary>
public sealed record BluffRulesConfig
{
	/// <summary>Authoritative duration of the writing phase of each round.</summary>
	public int WriteSeconds { get; init; } = 45;

	/// <summary>Authoritative duration of each voting phase (the first vote and, when there is
	/// one, the final).</summary>
	public int VoteSeconds { get; init; } = 30;

	/// <summary>Rounds played before the scores decide the match. A tie at the top adds one.</summary>
	public int Rounds { get; init; } = 5;

	/// <summary>Points for picking the truth in a round's only vote (or its first one).</summary>
	public int TruthPoints { get; init; } = 1000;

	/// <summary>Points a bluff earns per player it fools in a round's only vote (or its final),
	/// shared between its authors when several wrote the same bluff.</summary>
	public int FoolPoints { get; init; } = 500;

	/// <summary>How many bluffs a ballot carries beside the truth. With fewer bluffs than this,
	/// every ballot carries them all.</summary>
	public int BallotSize { get; init; } = 7;

	/// <summary>How many bluffs go through to the final, when the table is big enough for one.</summary>
	public int Finalists { get; init; } = 6;
}
