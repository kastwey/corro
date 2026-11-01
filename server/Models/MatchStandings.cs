namespace CorroServer.Models;

/// <summary>
/// The final table of a finished match: one row per SIDE, each with the number that side ended
/// on, in whatever the family actually counts (points, a square, wedges, pieces home…).
///
/// A side is a PLAYER in an individual game and a whole TEAM where partners play together, so a
/// 2v2 match reads as two rows naming both partners instead of four rows that never say who was
/// with whom. The engine owns the shape; each family fills it from its own sub-state, which is
/// the only place a score has ever lived.
///
/// Sealed into <see cref="GameState.FinalStandings"/> ONCE, when the match ends, rather than
/// recomputed per client: a hidden-information family hands every connection a different
/// projection, and a table computed from those would disagree between two players looking at the
/// same finished match. Nothing here is secret — the match is over — so the sealed copy travels
/// to everybody unchanged.
/// </summary>
public sealed record MatchStandings
{
	/// <summary>
	/// The i18n key naming the measure, resolved by every client in THEIR own language (and
	/// overridable by a package, like any other `game.*` key): "game.end_measure_points",
	/// "game.end_measure_square"…
	/// </summary>
	public required string MeasureKey { get; init; }

	/// <summary>The rows, best first. Ties are possible: partners share their side's place.</summary>
	public required IReadOnlyList<StandingSide> Sides { get; init; }
}

/// <summary>One row of the final table: who, in which place, with which number.</summary>
public sealed record StandingSide
{
	/// <summary>Everyone on this side, in seating order. Exactly one id in an individual game.</summary>
	public required IReadOnlyList<string> MemberIds { get; init; }

	/// <summary>Finishing place, 1 = winner. Mirrors <see cref="Player.FinishPlace"/>, which the
	/// families already stamp — this never re-decides who won.</summary>
	public required int Place { get; init; }

	/// <summary>
	/// The engine team index this side is, so the client names and colours it from the shared
	/// palette the rest of the match already speaks ("the red team"). Null when the side is one
	/// player playing for themselves.
	/// </summary>
	public int? TeamIndex { get; init; }

	/// <summary>What this side finished ON, in the measure named by
	/// <see cref="MatchStandings.MeasureKey"/>. Read, never sorted by: under a penalty count the
	/// lowest number wins, and the place already says who came first.</summary>
	public required int Value { get; init; }
}
