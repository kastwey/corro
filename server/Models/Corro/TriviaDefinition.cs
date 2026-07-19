namespace CorroServer.Models.Corro;

// The "trivia" game family (Trivial Pursuit style): a hub-and-spoke WHEEL board. Players roll
// and move; landing triggers a question of the square's category; a correct answer on a
// category headquarters ("wedge") earns that wedge. Collect all six wedges, return to the
// centre and answer a final question to win. board.json declares the wheel PARAMETERS — the
// engine builds the node graph from them (see Services/Rules/TriviaRulebook.BuildAdjacency).
// Questions ship as per-locale decks (real content per language, not a translation); the
// runtime picks the game's language once at start.

/// <summary>The six fixed categories of the classic wheel. The order is the canonical index
/// 0..5 used across board.json, questions and the client colour keys.</summary>
public static class TriviaCategories
{
	public const int Count = 6;
}

/// <summary>One ring slot of the wheel, in loop order. Exactly six of them are wedges (the
/// category headquarters where a correct answer earns a wedge); the rest are ordinary squares
/// or "roll again" squares.</summary>
public sealed record TriviaRingSlot
{
	/// <summary>Category 0..5 a landing here asks about.</summary>
	public int Category { get; init; }
	/// <summary>True for a category headquarters (one per category; six in total).</summary>
	public bool Wedge { get; init; }
	/// <summary>True for a "roll again" square (a correct-or-not extra roll).</summary>
	public bool RollAgain { get; init; }
}

/// <summary>A trivia wheel: a centre hub, six spokes of interior squares, and one outer ring.
/// The engine builds the node graph from these parameters. Node ids: "C" = centre;
/// "S{i}.{j}" = spoke i (0..5) interior square j (1..SpokeLength, from the centre outward);
/// "R{k}" = ring slot k. Spoke i connects the centre to the i-th wedge slot in ring order.</summary>
public sealed record TriviaBoardDef
{
	/// <summary>Interior squares on each spoke, between the centre and its wedge (classic ~5).</summary>
	public int SpokeLength { get; init; }
	/// <summary>The outer ring in loop order; must contain exactly six wedge slots (one per category).</summary>
	public List<TriviaRingSlot> Ring { get; init; } = new();
}

/// <summary>One question in a per-locale deck. Content is real per locale (not a translation);
/// only one language is in play per game (chosen at start).</summary>
public sealed record TriviaQuestionDef
{
	public string Id { get; init; } = string.Empty;
	/// <summary>Category 0..5 — must have a matching square colour to ever be asked.</summary>
	public int Category { get; init; }
	public string Prompt { get; init; } = string.Empty;
	/// <summary>The canonical correct answer (shown at the reveal).</summary>
	public string Answer { get; init; } = string.Empty;
	/// <summary>Extra accepted spellings/variants for the "typed" auto-judge mode (matched after
	/// normalisation). The canonical Answer is always accepted; these are additions.</summary>
	public List<string> Accept { get; init; } = new();
	/// <summary>Options for "choice" mode; the FIRST entry is the correct one (the engine shuffles
	/// them for display). Empty when the question only supports open answering.</summary>
	public List<string> Choices { get; init; } = new();
	public int Difficulty { get; init; } = 1;
}

/// <summary>Tunable rules of the trivia family (manifest "triviaRules"). Defaults are classic.</summary>
public sealed record TriviaRulesConfig
{
	/// <summary>How answers are adjudicated:
	///  "judge"  — classic: the active player writes an answer, a human judge rules yes/no;
	///  "choice" — multiple choice, auto-adjudicated (no judge);
	///  "typed"  — written answer, auto-matched against the accepted set (no judge).</summary>
	public string AnswerMode { get; init; } = "judge";

	/// <summary>Who judges in "judge" mode:
	///  "rotating" — the next player in turn order (classic);
	///  "fixed"    — a single judge the host picks at game start (start-time modal).</summary>
	public string JudgeMode { get; init; } = "rotating";

	/// <summary>Whether reaching the centre to win needs the exact count (classic true; false =
	/// any entry into the centre with all six wedges wins).</summary>
	public bool ExactFinish { get; init; } = true;

	/// <summary>Whether landing on the centre without all six wedges asks a wild question of the
	/// player's chosen category (classic true; false = the centre is inert until you can win).</summary>
	public bool CenterWild { get; init; } = true;

	/// <summary>Seconds allowed to answer before the earcon countdown fires; 0 = no timer.</summary>
	public int AnswerSeconds { get; init; }
}
