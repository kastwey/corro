namespace CorroServer.Models;

/// <summary>Public standing of one of the two equal teams.</summary>
public record ForbiddenTeamState
{
	public int TeamIndex { get; init; }
	public List<string> MemberIds { get; init; } = new();
	public int Score { get; set; }
	/// <summary>Timed turns this team has completed. It also rotates clue-givers.</summary>
	public int TurnsTaken { get; set; }
}

public enum ForbiddenTurnPhase
{
	Preparing,
	Active,
	Finished,
}

/// <summary>The current role assignment and card. Target/forbidden text is private and is
/// projected only to the clue-giver and opposing monitor.</summary>
public record ForbiddenTurnState
{
	public int TurnNumber { get; init; }
	public int TeamIndex { get; init; }
	public required string ClueGiverId { get; init; }
	public required string GuesserId { get; init; }
	public required string MonitorId { get; init; }

	public ForbiddenTurnPhase Phase { get; set; } = ForbiddenTurnPhase.Preparing;
	public DateTime? StartedAt { get; set; }
	public int DurationSeconds { get; init; }
	public int PassesUsed { get; set; }
	public int CorrectCount { get; set; }
	public int ViolationCount { get; set; }

	/// <summary>Monotonic card generation. Every card action carries this value so a
	/// near-simultaneous click cannot resolve the next card by mistake.</summary>
	public int CardSequence { get; set; }

	/// <summary>Private current-card fields. Null/empty in unauthorized projections.</summary>
	public string? CardId { get; set; }
	public string? Target { get; set; }
	public List<string> ForbiddenWords { get; set; } = new();
}

/// <summary>Everything specific to a forbidden-word game.</summary>
public record ForbiddenState
{
	public List<ForbiddenTeamState> Teams { get; init; } = new();
	public int ActiveTeamIndex { get; set; }
	public int Cycle { get; set; } = 1;
	public int CardCursor { get; set; }
	public int CardSequence { get; set; }
	public required ForbiddenTurnState Turn { get; set; }
}
