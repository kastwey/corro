namespace CorroServer.Models;

/// <summary>One player's standing in a trivia game: where their piece sits on the wheel and
/// which category wedges they have earned. Everyone starts at the centre ("C").</summary>
public record TriviaPlayerState
{
	public required string PlayerId { get; init; }
	/// <summary>Current node id on the wheel graph ("C" = centre; "S{i}.{j}" = spoke; "R{k}" = ring).</summary>
	public string Node { get; set; } = "C";
	/// <summary>Categories (0..5) whose wedge this player has earned.</summary>
	public List<int> Wedges { get; init; } = new();
	/// <summary>True once the player has left the game (folded seat; skipped by rotation/judging).</summary>
	public bool Retired { get; set; }
}

/// <summary>The host must pick a judge before play begins (judgeMode "fixed"). Until this is
/// resolved by a ChooseJudge command, CurrentTurn is null and no one can act.</summary>
public record TriviaPendingJudgeSetup
{
	/// <summary>The host (game creator) who chooses the judge.</summary>
	public required string HostId { get; init; }
}

/// <summary>The move choice offered after a roll: the legal landing nodes. Only the landing
/// matters in trivia (the route is irrelevant), so the player just picks where to end up.</summary>
public record TriviaPendingMove
{
	public required string PlayerId { get; init; }
	public int Rolled { get; init; }
	/// <summary>Legal landing node ids the player may choose from.</summary>
	public List<string> Options { get; init; } = new();
}

/// <summary>A question in flight: who answers, who judges, what was asked, and — server-only,
/// blanked by <c>TriviaFamily.ProjectFor</c> for everyone except the judge — the correct
/// answer. Kept in the FULL state so it survives save/restore.</summary>
public record TriviaPendingQuestion
{
	/// <summary>The player answering.</summary>
	public required string PlayerId { get; init; }
	/// <summary>The player who rules on the answer ("" in the auto modes: choice/typed).</summary>
	public required string JudgeId { get; init; }
	public required string QuestionId { get; init; }
	public int Category { get; init; }
	/// <summary>The question text, copied here so clients can show it without the (hidden) deck.</summary>
	public string Prompt { get; init; } = string.Empty;
	/// <summary>Shuffled option texts for "choice" mode (empty otherwise). The order is public;
	/// which option is correct is not sent to clients (see CorrectChoice).</summary>
	public List<string> Choices { get; init; } = new();
	/// <summary>The active player's submitted answer, once given (null until then). In "choice"
	/// mode this is the chosen option text.</summary>
	public string? Submitted { get; set; }
	/// <summary>Landed on a category headquarters → a correct answer earns that wedge.</summary>
	public bool OnWedge { get; init; }
	/// <summary>A centre wild question (no wedge; classic house rule).</summary>
	public bool AtCenter { get; init; }
	/// <summary>The final winning question (all wedges collected, back at the centre).</summary>
	public bool IsFinal { get; init; }
	/// <summary>The correct answer. Server-only: blanked for everyone but the judge (and for the
	/// public view) by ProjectFor.</summary>
	public string? CorrectAnswer { get; set; }
	/// <summary>Correct index into <see cref="Choices"/> for "choice" mode. Server-only (blanked
	/// by ProjectFor); -1 when not a choice question.</summary>
	public int CorrectChoice { get; init; } = -1;
}

/// <summary>Everything trivia-specific inside GameState (null in other families).</summary>
public record TriviaState
{
	public List<TriviaPlayerState> Players { get; init; } = new();

	/// <summary>The fixed judge chosen by the host (judgeMode "fixed"); null in rotating mode.</summary>
	public string? FixedJudgeId { get; set; }

	/// <summary>Non-null while the host still owes a judge choice (blocks the first turn).</summary>
	public TriviaPendingJudgeSetup? PendingJudgeSetup { get; set; }

	/// <summary>Non-null while the active player must choose a landing square after a roll.</summary>
	public TriviaPendingMove? PendingMove { get; set; }

	/// <summary>Non-null while a question is being answered/judged.</summary>
	public TriviaPendingQuestion? PendingQuestion { get; set; }

	/// <summary>A per-category cursor (length 6) into the deck, so each category serves its
	/// questions in deal order and wraps when exhausted.</summary>
	public List<int> CategoryCursors { get; init; } = new();
}
