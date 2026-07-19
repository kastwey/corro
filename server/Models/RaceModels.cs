namespace CorroServer.Models;

// Runtime state of a "race" family game (parcheesi-style). Lives inside GameState.Race so the
// transport/persistence/announcement pipeline is shared with every family; only the rulebook
// and the client board renderer are family-specific.

// Serialized snake_case lower by the transport/persistence options ("home", "circuit"…),
// like every other enum on the wire.
public enum RacePieceLocation
{
	/// <summary>In the player's home/nest, not on the board yet (exits on the exit roll).</summary>
	Home,
	/// <summary>On the shared circuit; <see cref="RacePiece.Square"/> is 1..circuitLength.</summary>
	Circuit,
	/// <summary>In the seat's private corridor; <see cref="RacePiece.Square"/> is 1..corridorLength.</summary>
	Corridor,
	/// <summary>Arrived at the goal. Terminal.</summary>
	Goal,
}

public record RacePiece
{
	public RacePieceLocation Location { get; set; } = RacePieceLocation.Home;
	/// <summary>Position within <see cref="Location"/> (meaningless for Home/Goal).</summary>
	public int Square { get; set; }
}

/// <summary>One player's side of a race game: their seat on the board and their pieces.</summary>
public record RaceSeatState
{
	public required string PlayerId { get; init; }
	/// <summary>The board seat (colour/start/corridor) this player plays; see RaceBoardDef.Seats.</summary>
	public required string SeatId { get; init; }
	public List<RacePiece> Pieces { get; init; } = new();
}

/// <summary>
/// A move the current player must resolve by choosing a piece: either the steps of the die
/// they just rolled, or a bonus (capture/goal award). Stored so a reconnecting client can
/// re-open the choice.
/// </summary>
public record PendingRaceMove
{
	public required string PlayerId { get; init; }
	/// <summary>How many steps the chosen piece must advance.</summary>
	public required int Steps { get; init; }
	/// <summary>Why these steps exist: "roll", "captureBonus" or "goalBonus" (drives the prompt text).</summary>
	public required string Kind { get; init; }
	/// <summary>The die value that opened this turn (extra-roll bookkeeping after the choice).</summary>
	public int Rolled { get; init; }
	/// <summary>Whose SEAT the options move. Normally the actor; in teams mode a finished
	/// actor moves their partner's pieces, so client labels and the apply must use this
	/// seat, not the actor's. Null means the actor's own seat.</summary>
	public string? MoverId { get; init; }
	/// <summary>The legal options (piece + destination), so client and server agree on what
	/// is choosable; the server recomputes on apply anyway (authoritative).</summary>
	public List<RaceMoveOption> Options { get; init; } = new();
}

/// <summary>One legal move for one piece, with everything the UI needs to voice the choice.</summary>
public record RaceMoveOption
{
	/// <summary>Index of the piece in the seat's piece list (0-based).</summary>
	public required int PieceIndex { get; init; }
	/// <summary>Where the piece ends: a location + square (as in <see cref="RacePiece"/>).</summary>
	public required RacePieceLocation ToLocation { get; init; }
	public int ToSquare { get; init; }
	/// <summary>True when this move exits home onto the seat's start square.</summary>
	public bool ExitsHome { get; init; }
	/// <summary>Player id whose piece would be captured by this move, when any.</summary>
	public string? CapturesPlayerId { get; init; }
	/// <summary>True when the move breaks one of the mover's own barriers (two pieces together).</summary>
	public bool BreaksOwnBarrier { get; init; }
}

/// <summary>Everything race-specific inside GameState (null in other families).</summary>
public record RaceState
{
	public List<RaceSeatState> Seats { get; init; } = new();
	/// <summary>Classic pairs mode (chosen in the lobby, 4 players): OPPOSITE seats are
	/// partners, partners cannot be captured, a finished player moves their partner's
	/// pieces, and the TEAM wins when both seats are complete. Persisted with the game.</summary>
	public bool TeamsMode { get; init; }
	/// <summary>Consecutive extra-roll values (6s) the current player has rolled this turn.</summary>
	public int ConsecutiveSixes { get; set; }
	/// <summary>The piece the current player moved last this turn (for the three-sixes penalty).</summary>
	public int? LastMovedPieceIndex { get; set; }
	/// <summary>A piece choice the current player must resolve before anything else happens.</summary>
	public PendingRaceMove? PendingMove { get; set; }
	/// <summary>Queued bonus moves (steps) earned but not yet played (capture +20, goal +10 chain).</summary>
	public List<int> PendingBonuses { get; init; } = new();
	/// <summary>Bonus kinds parallel to <see cref="PendingBonuses"/> ("captureBonus"/"goalBonus").</summary>
	public List<string> PendingBonusKinds { get; init; } = new();
}
