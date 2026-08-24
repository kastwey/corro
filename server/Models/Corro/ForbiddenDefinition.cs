namespace CorroServer.Models.Corro;

// The forbidden-word game family has no spatial board and no hand. A package supplies one
// real word deck per locale (words.<locale>.json); the host's game language selects exactly
// one at start, while every player's interface remains in their own client locale.

/// <summary>One target word and the words the clue-giver may not say.</summary>
public sealed record ForbiddenWordDef
{
	/// <summary>Stable package-owned identifier. It is never used as player-facing text.</summary>
	public string Id { get; init; } = string.Empty;

	/// <summary>The word or short phrase the guesser must identify.</summary>
	public string Target { get; init; } = string.Empty;

	/// <summary>Words or phrases the clue-giver may not use. A human monitor enforces them;
	/// Corro never records or transcribes the conversation.</summary>
	public List<string> Forbidden { get; init; } = new();
}

/// <summary>Family rules from manifest <c>forbiddenRules</c>.</summary>
public sealed record ForbiddenRulesConfig
{
	/// <summary>Authoritative duration of each clue-giving turn.</summary>
	public int TurnSeconds { get; init; } = 60;

	/// <summary>How many cards the clue-giver may skip during one timed turn.</summary>
	public int PassesPerTurn { get; init; } = 3;

	/// <summary>Points earned when the clue-giver marks a guess correct.</summary>
	public int CorrectPoints { get; init; } = 1;

	/// <summary>Points lost when the opposing monitor reports a forbidden word.</summary>
	public int ViolationPenalty { get; init; } = 1;

	/// <summary>Complete rotations every player must take as clue-giver before scores decide
	/// the game. A tie automatically adds another complete rotation.</summary>
	public int Cycles { get; init; } = 1;

	/// <summary>House rule: what ends the match. "rounds" = play <see cref="Cycles"/> complete
	/// rotations and the higher score wins (what this family always did, ties adding a rotation);
	/// "score" = the first team to reach <see cref="TargetScore"/> wins, which can happen
	/// mid-rotation — but never mid-TURN: the turn in play is always finished, so both teams keep
	/// the equal number of turns the family is built on.</summary>
	public string EndMode { get; init; } = "rounds";

	/// <summary>Points that win the match when <see cref="EndMode"/> is "score".</summary>
	public int TargetScore { get; init; } = 30;
}
