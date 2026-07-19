using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Rules;

/// <summary>What one applied track move did (for announcements and the finish flow).</summary>
public sealed record TrackMoveResult
{
	/// <summary>Square the piece stood on before the roll (0 = off the board).</summary>
	public required int From { get; init; }
	/// <summary>Square the WALK ended on, before any effect (after a bounce, when applicable).</summary>
	public required int Landed { get; init; }
	/// <summary>True when the roll overshot the final square and the piece walked back the excess.</summary>
	public bool Bounced { get; init; }
	/// <summary>The effects applied on landing, in chain order (a ladder may drop you on a snake).</summary>
	public List<TrackEffectDef> EffectsApplied { get; init; } = new();
	/// <summary>Where the piece finally rests.</summary>
	public required int Final { get; init; }
	/// <summary>True when the piece reached the final square exactly.</summary>
	public bool Won { get; init; }
}

/// <summary>
/// Pure rules of the "track" game family (snakes-and-ladders style): one piece per player
/// on a linear 1..N track. Stateless over (board, rules, state) so every rule is
/// unit-testable without transport; the command layer owns dice, turn flow and announcements.
///
/// Classic conventions implemented:
///  * everyone starts OFF the board (square 0); the first roll enters at its value;
///  * the final square needs an exact count — overshooting bounces back the excess
///    (configurable: "bounce" | "stay");
///  * landing on an effect square teleports (ladder up, snake down — pure theme data), and
///    effects CHAIN: a ladder may drop you at the mouth of a snake. A visited-set guards
///    against a mis-authored effect cycle;
///  * squares hold any number of pieces (no captures, no blocking — pure luck).
/// </summary>
public static class TrackRulebook
{
	public static TrackPlayerPosition PositionOf(TrackState state, string playerId)
		=> state.Positions.First(p => p.PlayerId == playerId);

	/// <summary>Applies a roll to the player's piece and reports everything that happened.</summary>
	public static TrackMoveResult Move(
		TrackBoardDef board, TrackRulesConfig rules, TrackState state, string playerId, int rolled)
	{
		var position = PositionOf(state, playerId);
		var from = position.Square;

		var target = from + rolled;
		var bounced = false;
		if (target > board.TrackLength)
		{
			if (rules.ExactFinish == "stay")
			{
				// The move is lost: the piece needs the exact count and stays put.
				return new TrackMoveResult { From = from, Landed = from, Final = from };
			}
			// Classic bounce: walk to the end, then back the excess.
			target = board.TrackLength - (target - board.TrackLength);
			bounced = true;
		}

		// Apply the landing effect, chaining (with a guard against authoring cycles).
		var applied = new List<TrackEffectDef>();
		var landed = target;
		var visited = new HashSet<int> { target };
		while (board.Effects.FirstOrDefault(e => e.From == target) is { } effect)
		{
			applied.Add(effect);
			target = effect.To;
			if (!visited.Add(target))
			{
				break; // cycle in the data: stop rather than loop
			}
		}

		// No mutation here: the FLOW applies the position in stages (landing, then each
		// effect hop) so every stage can ship as its own turn segment — the piece visibly
		// stops where the die landed before following the board effect.
		return new TrackMoveResult
		{
			From = from,
			Landed = landed,
			Bounced = bounced,
			EffectsApplied = applied,
			Final = target,
			Won = target == board.TrackLength,
		};
	}

	/// <summary>Fresh per-player state for a new game (everyone off the board).</summary>
	public static TrackState CreateInitialState(IEnumerable<string> playerIds)
		=> new()
		{
			Positions = playerIds.Select(id => new TrackPlayerPosition { PlayerId = id, Square = 0 }).ToList(),
		};
}
