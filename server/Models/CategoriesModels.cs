namespace CorroServer.Models;

/// <summary>A player's running total across the match.</summary>
public record CategoriesPlayerState
{
	public required string PlayerId { get; init; }
	public int Score { get; set; }
	/// <summary>Rounds this player has judged. It also drives the judge rotation.</summary>
	public int RoundsJudged { get; set; }
}

public enum CategoriesRoundPhase
{
	/// <summary>The letter and the categories are public; the judge has not started the clock.</summary>
	Preparing,
	/// <summary>The clock is running and everyone but the judge is writing.</summary>
	Writing,
	/// <summary>The clock is spent; the judge is ruling on one category at a time.</summary>
	Review,
	Finished,
}

/// <summary>What the judge decided about one written answer. Pending is the only value that
/// still needs a human: every other value has been ruled and is worth its points (or none).</summary>
public enum CategoriesVerdict
{
	Pending,
	Accepted,
	Rejected,
	/// <summary>The same answer as at least one rival's, so nobody scores it.</summary>
	Duplicate,
}

/// <summary>One player's answer to one category. The text is written by a player, so it is
/// never used as a translation key and never interpolated into markup.</summary>
public record CategoriesAnswerState
{
	public required string PlayerId { get; init; }
	public string Text { get; set; } = string.Empty;
	public CategoriesVerdict Verdict { get; set; } = CategoriesVerdict.Pending;

	/// <summary>Answers that normalize to the same text share a group number, so the judge sees
	/// the coincidences already gathered instead of hunting for them. It is a HINT, never a
	/// ruling: the judge still decides whether two spellings are the same answer. -1 = unique.</summary>
	public int DuplicateGroup { get; set; } = -1;

	/// <summary>False when the text does not begin with the round's letter — the one mechanical
	/// check worth surfacing. Also a hint: a judge may still accept "the Alps" for A.</summary>
	public bool MatchesLetter { get; set; }
}

/// <summary>One category of the round, with every player's answer to it.</summary>
public record CategoriesPromptState
{
	public required string CategoryId { get; init; }
	/// <summary>The category text in the table's shared content language, taken from the package
	/// deck at deal time. It is content, not a key: the whole table reads the same words.</summary>
	public required string Name { get; init; }
	public List<CategoriesAnswerState> Answers { get; init; } = new();
}

/// <summary>The round everyone is playing: its judge, its letter, its categories and its clock.</summary>
public record CategoriesRoundState
{
	public int RoundNumber { get; init; }
	/// <summary>Who rules on this round's answers. The judge does not write.</summary>
	public required string JudgeId { get; init; }
	/// <summary>The initial every answer must start with, already upper-cased for display.</summary>
	public required string Letter { get; init; }

	public CategoriesRoundPhase Phase { get; set; } = CategoriesRoundPhase.Preparing;
	public DateTime? StartedAt { get; set; }
	public int DurationSeconds { get; init; }

	public List<CategoriesPromptState> Prompts { get; init; } = new();

	/// <summary>Writers who declared themselves done. When they are all in, the round moves to
	/// review without waiting out the clock.</summary>
	public List<string> FinishedWriterIds { get; init; } = new();

	/// <summary>Which prompt the judge is ruling on during review; equal to Prompts.Count once
	/// every category has been ruled.</summary>
	public int ReviewIndex { get; set; }
}

/// <summary>Everything specific to a categories game.</summary>
public record CategoriesState
{
	public List<CategoriesPlayerState> Players { get; init; } = new();
	/// <summary>Complete judge rotations played so far, starting at 1. A tie adds another.</summary>
	public int Cycle { get; set; } = 1;
	/// <summary>How far the shuffled category deck has been dealt (it wraps).</summary>
	public int CategoryCursor { get; set; }
	/// <summary>How far the shuffled letter pool has been dealt (it wraps).</summary>
	public int LetterCursor { get; set; }
	public required CategoriesRoundState Round { get; set; }
}
