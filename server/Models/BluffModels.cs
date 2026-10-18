namespace CorroServer.Models;

/// <summary>A player's running total across the match.</summary>
public record BluffPlayerState
{
	public required string PlayerId { get; init; }
	public int Score { get; set; }
}

public enum BluffPhase
{
	/// <summary>The round is dealt; the host has not opened the writing clock.</summary>
	Preparing,
	/// <summary>The question is out and everybody is writing a bluff against the clock.</summary>
	Writing,
	/// <summary>Every ballot is out: the truth hides among a handful of bluffs.</summary>
	Voting,
	/// <summary>A big table's second vote, among the bluffs the first one liked most.</summary>
	FinalVoting,
	/// <summary>The truth, the best bluff and the funniest one are on the table; the host moves on.</summary>
	Reveal,
	Finished,
}

/// <summary>One player's bluff for the round. The text is written by a player, so it is never
/// used as a translation key and never interpolated into markup.</summary>
public record BluffEntryState
{
	public required string PlayerId { get; init; }
	public string Text { get; set; } = string.Empty;
	/// <summary>The writer declared themselves done (with a bluff or without one).</summary>
	public bool Finished { get; set; }
}

/// <summary>One distinct bluff on the table once the writing closes: identical texts are merged
/// and every author of the merged bluff shares its fate.</summary>
public record BluffLieState
{
	public required string Id { get; init; }
	public required string Text { get; init; }
	public List<string> AuthorIds { get; init; } = new();
	/// <summary>How many first-vote ballots carried this bluff: what "seen by seven people" means.</summary>
	public int ShownCount { get; set; }
	/// <summary>Who took it for the truth in the first vote.</summary>
	public List<string> BelieverIds { get; init; } = new();
	/// <summary>Who called it the funniest in the first vote.</summary>
	public List<string> FunnyVoterIds { get; init; } = new();
	public bool Finalist { get; set; }
	/// <summary>Who took it for the truth in the final — or, having found the truth already,
	/// said it would have fooled them.</summary>
	public List<string> FinalBelieverIds { get; init; } = new();
}

/// <summary>One line of a ballot: its position, its text, and — server-side only — what it
/// stands for. The key never leaves the server: a ballot whose options said which one was the
/// truth would be no vote at all.</summary>
public record BluffOptionState
{
	public int Index { get; init; }
	public required string Text { get; init; }
	/// <summary>The bluff's id, or <see cref="BluffBallotState.TruthKey"/> for the truth. Blank
	/// in every projection.</summary>
	public string Key { get; init; } = string.Empty;
}

/// <summary>One player's ballot in one vote: the options they see, in their own order, and the
/// marks they have made. A ballot is private to its owner until the match forgets it.</summary>
public record BluffBallotState
{
	public const string TruthKey = "truth";

	public required string PlayerId { get; init; }
	public List<BluffOptionState> Options { get; init; } = new();
	/// <summary>True when the ballot also asks for the funniest bluff (two or more bluffs on it).</summary>
	public bool AsksFunny { get; init; }
	/// <summary>True on a final ballot handed to somebody who already found the truth: the truth is
	/// not on it, and the one question is which bluff would have fooled them.</summary>
	public bool TruthKnown { get; init; }
	/// <summary>Index of the option marked as the truth (or, with <see cref="TruthKnown"/>, as the
	/// most convincing bluff); null until marked.</summary>
	public int? TruthPick { get; set; }
	/// <summary>Index of the option marked as the funniest; null until marked or when not asked.</summary>
	public int? FunnyPick { get; set; }
}

/// <summary>What one player took from the round, for the private line each of them hears.</summary>
public record BluffPlayerResult
{
	public required string PlayerId { get; init; }
	public bool FoundTruth { get; init; }
	public int TruthPoints { get; init; }
	/// <summary>Players this player's bluff fooled, across both votes.</summary>
	public int FooledCount { get; init; }
	public int FoolPoints { get; init; }
	/// <summary>How many first-vote ballots carried this player's bluff.</summary>
	public int ShownCount { get; init; }
	public int Total { get; init; }
}

/// <summary>The round's verdict, computed once and kept so a late arrival reads the same reveal.</summary>
public record BluffRevealState
{
	public int TruthFinderCount { get; init; }
	public string? BestLieId { get; init; }
	public string? FunniestLieId { get; init; }
	public List<BluffPlayerResult> Results { get; init; } = new();
}

/// <summary>The round everyone is playing: its question, its clock, and each phase's material.</summary>
public record BluffRoundState
{
	public int RoundNumber { get; init; }
	public required string QuestionId { get; init; }
	/// <summary>The question in the table's shared content language. Content, not a key.</summary>
	public required string Question { get; init; }
	/// <summary>The true answer. Blank in every projection until the reveal.</summary>
	public string Truth { get; set; } = string.Empty;
	/// <summary>Other wordings of the truth a bluff must not match. Server-only: never projected.</summary>
	public List<string> TruthVariants { get; init; } = new();

	public BluffPhase Phase { get; set; } = BluffPhase.Preparing;
	public DateTime? StartedAt { get; set; }
	public int DurationSeconds { get; set; }

	public List<BluffEntryState> Entries { get; init; } = new();
	public List<BluffLieState> Lies { get; init; } = new();
	/// <summary>The first vote's ballots, one per player. Each is projected to its owner alone.</summary>
	public List<BluffBallotState> Ballots { get; init; } = new();
	/// <summary>True when the first vote only narrowed the field and a final decides it.</summary>
	public bool HasFinal { get; set; }
	public List<BluffBallotState> FinalBallots { get; init; } = new();
	/// <summary>Who picked the truth in the first vote. Projected to each player as their own
	/// entry alone until the reveal.</summary>
	public List<string> TruthFinderIds { get; init; } = new();
	/// <summary>Who picked the truth in the final.</summary>
	public List<string> FinalTruthFinderIds { get; init; } = new();
	public BluffRevealState? Reveal { get; set; }
	/// <summary>How many players the current timed phase is still waiting for. Written by the
	/// projection, never by the rules: the other players' ballots never reach a client, so the
	/// count is the one thing it can know about them.</summary>
	public int PendingCount { get; set; }
}

/// <summary>Everything specific to a bluff game.</summary>
public record BluffState
{
	public List<BluffPlayerState> Players { get; init; } = new();
	/// <summary>The seat that opens each round and moves the table past each reveal: the host,
	/// and the next human in seat order when the host leaves.</summary>
	public required string MasterId { get; set; }
	/// <summary>How far the shuffled question deck has been dealt (it wraps).</summary>
	public int QuestionCursor { get; set; }
	/// <summary>Rounds the match will play: the rules' count, plus one per tie at the top.</summary>
	public int RoundsToPlay { get; set; }
	public required BluffRoundState Round { get; set; }
}
