namespace CorroServer.Models.Corro;

// The "track" game family (snakes-and-ladders style): a single linear track every player
// walks with one piece; squares may carry a TELEPORT effect (a ladder up, a snake down).
// These records are the track package's board.json and rules sections — the family-specific
// counterpart of SquareDef/RulesConfig ("property") and RaceBoardDef ("race").

/// <summary>A square effect: landing on <see cref="From"/> moves the piece to <see cref="To"/>.
/// <see cref="Kind"/> is pure THEME data ("ladder", "snake", …): it drives the drawing and the
/// per-kind names in the package i18n; the engine only cares about the jump itself.</summary>
public sealed record TrackEffectDef
{
	public int From { get; init; }
	public int To { get; init; }
	public string Kind { get; init; } = string.Empty;
}

/// <summary>A track board: N squares walked 1..N, laid out as a serpentine grid.</summary>
public sealed record TrackBoardDef
{
	/// <summary>Number of squares (classic snakes and ladders: 100).</summary>
	public int TrackLength { get; init; }
	/// <summary>Columns of the serpentine grid the client draws (classic: 10).</summary>
	public int GridWidth { get; init; }
	public List<TrackEffectDef> Effects { get; init; } = new();
}

/// <summary>Tunable rules of the track family (manifest "trackRules"). Defaults are classic.</summary>
public sealed record TrackRulesConfig
{
	/// <summary>What happens when the roll overshoots the final square:
	/// "bounce" (classic — walk to the end and back the excess), "stay" (the move is lost).</summary>
	public string ExactFinish { get; init; } = "bounce";
	/// <summary>Whether rolling the die's maximum grants another roll (variant; classic off).</summary>
	public bool RollAgainOnMax { get; init; }
}
