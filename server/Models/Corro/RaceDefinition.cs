namespace CorroServer.Models.Corro;

// The "race" game family (parcheesi-style): several pieces per player racing around a shared
// circuit into a private final corridor. These records are the race package's board.json and
// rules sections — the family-specific counterpart of SquareDef/RulesConfig in "property".

/// <summary>One seat (colour) on a race board: where its pieces enter the circuit and where
/// they leave it into their private corridor.</summary>
public sealed record RaceSeatDef
{
	public string Id { get; init; } = string.Empty;
	/// <summary>Seat colour (inline hex, visual aid — the accessible identity is the name).</summary>
	public string? Color { get; init; }
	/// <summary>i18n key for the seat's display name (e.g. "seats.s1").</summary>
	public string? NameKey { get; init; }
	/// <summary>Circuit square (1-based) where this seat's pieces land when leaving home.</summary>
	public int StartSquare { get; init; }
	/// <summary>Circuit square from which this seat turns off into its corridor: a piece ON this
	/// square enters corridor square 1 with its next step instead of continuing the circuit.</summary>
	public int CorridorEntry { get; init; }
}

/// <summary>A race board: a shared circuit plus one home/corridor/goal per seat.</summary>
public sealed record RaceBoardDef
{
	/// <summary>Number of squares in the shared circuit (classic parcheesi: 68).</summary>
	public int CircuitLength { get; init; }
	/// <summary>Squares in each seat's private corridor before the goal (classic: 7).</summary>
	public int CorridorLength { get; init; }
	/// <summary>Pieces per player (classic: 4).</summary>
	public int PiecesPerPlayer { get; init; }
	/// <summary>Circuit squares where pieces cannot be captured (includes every seat's start).</summary>
	public List<int> SafeSquares { get; init; } = new();
	public List<RaceSeatDef> Seats { get; init; } = new();
}

/// <summary>Tunable rules of the race family (manifest "raceRules"). Defaults are classic parcheesi.</summary>
public sealed record RaceRulesConfig
{
	/// <summary>Die value that lets a piece leave home (and MUST be used to, when legal).</summary>
	public int ExitOn { get; init; } = 5;
	/// <summary>Die value that grants an extra roll.</summary>
	public int ExtraRollOn { get; init; } = 6;
	/// <summary>Third consecutive extra-roll value sends the last piece moved home (unless it
	/// already left the circuit into the corridor/goal).</summary>
	public bool ThreeSixesPenalty { get; init; } = true;
	/// <summary>Bonus steps (with any piece) after capturing an opponent's piece.</summary>
	public int CaptureBonus { get; init; } = 20;
	/// <summary>Bonus steps (with any piece) after bringing a piece to the goal.</summary>
	public int GoalBonus { get; init; } = 10;
	/// <summary>Classic: when none of your pieces are at home, a rolled 6 moves 7.</summary>
	public bool SixWorthSevenWhenNoneHome { get; init; } = true;
	/// <summary>Two same-seat pieces on a square block EVERYONE's passage (including their owner),
	/// and a rolled 6 must open one of your barriers when such a move is legal.</summary>
	public bool Barriers { get; init; } = true;
}
