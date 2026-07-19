using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Rules;

/// <summary>What one applied race move did (for announcements and follow-up bonuses).</summary>
public sealed record RaceMoveResult
{
	public required RaceMoveOption Move { get; init; }
	/// <summary>Player whose piece was sent home by this move, when any.</summary>
	public string? CapturedPlayerId { get; init; }
	public bool ReachedGoal { get; init; }
	/// <summary>True when the mover just brought their LAST piece to the goal.</summary>
	public bool PlayerFinished { get; init; }
	/// <summary>True when the move just paired two of the mover's pieces on a circuit
	/// square — a fresh barrier, which is table news worth voicing.</summary>
	public bool FormedBarrier { get; init; }
}

/// <summary>
/// Pure rules of the "race" game family (parcheesi-style): which pieces may move for a given
/// roll and what happens when one does. Stateless over (board, rules, state) so every rule is
/// unit-testable without transport; the command layer owns dice, turn flow and announcements.
///
/// Classic conventions implemented:
///  * exit home only on the exit value (5), MANDATORY when legal — and it captures an opponent
///    piece sitting on your start square (the one exception to safe squares);
///  * capture on landing over a lone opponent on a non-safe square → +20 bonus steps;
///  * bringing a piece to the goal → +10 bonus steps; bonuses move any piece but never exit home;
///  * two same-seat pieces form a barrier nobody passes (owner included); rolling the extra-roll
///    value (6) obliges the owner to open a barrier when such a move is legal;
///  * a rolled 6 moves 7 when none of your pieces are at home (classic "el 6 vale 7");
///  * squares hold at most two pieces; different seats share only on safe squares;
///  * the corridor needs an exact count — overshooting the goal makes the move illegal.
/// </summary>
public static class RaceRulebook
{
	// ── queries ──────────────────────────────────────────────────────────────

	public static RaceSeatState SeatOf(RaceState state, string playerId)
		=> state.Seats.First(s => s.PlayerId == playerId);

	public static RaceSeatDef SeatDefOf(RaceBoardDef board, RaceState state, string playerId)
		=> board.Seats.First(s => s.Id == SeatOf(state, playerId).SeatId);

	/// <summary>All pieces standing on a circuit square, as (seat, pieceIndex) pairs.</summary>
	private static List<(RaceSeatState Seat, int PieceIndex)> CircuitOccupants(RaceState state, int square)
	{
		var result = new List<(RaceSeatState, int)>();
		foreach (var seat in state.Seats)
		{
			for (var i = 0; i < seat.Pieces.Count; i++)
			{
				if (seat.Pieces[i].Location == RacePieceLocation.Circuit && seat.Pieces[i].Square == square)
				{
					result.Add((seat, i));
				}
			}
		}

		return result;
	}

	/// <summary>True when two pieces of the same seat stand on the circuit square (a barrier).</summary>
	private static bool HasBarrier(RaceState state, int square)
	{
		var occupants = CircuitOccupants(state, square);
		return occupants.Count == 2 && occupants[0].Seat.PlayerId == occupants[1].Seat.PlayerId;
	}

	/// <summary>Own pieces on one of the seat's corridor squares.</summary>
	private static int CorridorOccupants(RaceSeatState seat, int corridorSquare)
		=> seat.Pieces.Count(p => p.Location == RacePieceLocation.Corridor && p.Square == corridorSquare);

	/// <summary>The circuit squares where this player currently has a barrier.</summary>
	public static List<int> OwnBarriers(RaceState state, string playerId)
		=> SeatOf(state, playerId).Pieces
			.Where(p => p.Location == RacePieceLocation.Circuit)
			.GroupBy(p => p.Square)
			.Where(g => g.Count() >= 2)
			.Select(g => g.Key)
			.ToList();

	/// <summary>The steps a rolled value actually moves (classic: 6 moves 7 with no piece at home).</summary>
	public static int EffectiveSteps(RaceRulesConfig rules, RaceSeatState seat, int rolled)
		=> rolled == rules.ExtraRollOn
		   && rules.SixWorthSevenWhenNoneHome
		   && seat.Pieces.All(p => p.Location != RacePieceLocation.Home)
			? rolled + 1
			: rolled;

	// ── legal moves ──────────────────────────────────────────────────────────

	/// <summary>The moves a roll allows, plus which OBLIGATION (if any) restricted them --
	/// so the flow can tell the player WHY other pieces are locked this turn.</summary>
	public sealed record RollMoves(List<RaceMoveOption> Options, string? Mandate);

	/// <summary>
	/// Legal moves for the ROLL the player just made. Applies the roll-bound obligations:
	/// a rolled exit value must exit when legal; a rolled extra-roll value must open one of
	/// the player's barriers when such a move is legal. (Bonus moves use
	/// <see cref="LegalMoves"/> directly: they never exit home and carry no obligations.)
	/// </summary>
	public static List<RaceMoveOption> LegalMovesForRoll(
		RaceBoardDef board, RaceRulesConfig rules, RaceState state, string playerId, int rolled)
		=> LegalMovesForRollDetailed(board, rules, state, playerId, rolled).Options;

	/// <summary>Like <see cref="LegalMovesForRoll"/>, also reporting the applied obligation:
	/// "exit" / "barrier" when the rule LOCKED otherwise-movable pieces, null otherwise.</summary>
	public static RollMoves LegalMovesForRollDetailed(
		RaceBoardDef board, RaceRulesConfig rules, RaceState state, string playerId, int rolled)
	{
		var seat = SeatOf(state, playerId);
		var seatDef = SeatDefOf(board, state, playerId);
		var steps = EffectiveSteps(rules, seat, rolled);

		// Mandatory exit: with the exit value and a piece at home, exiting is the ONLY move
		// (all home pieces are interchangeable, so a single option is offered).
		if (rolled == rules.ExitOn && seat.Pieces.Any(p => p.Location == RacePieceLocation.Home))
		{
			var exit = ExitOption(board, state, seat, seatDef);
			if (exit != null)
			{
				// The obligation only needs explaining when it LOCKED a board piece that
				// could otherwise have moved.
				var suppressed = LegalMoves(board, rules, state, playerId, steps).Count > 0;
				return new RollMoves(new List<RaceMoveOption> { exit }, suppressed ? "exit" : null);
			}
			// Exit blocked (e.g. own barrier on the start): fall through to normal moves.
		}

		var moves = LegalMoves(board, rules, state, playerId, steps);

		// Mandatory barrier opening on the extra-roll value.
		if (rules.Barriers && rolled == rules.ExtraRollOn)
		{
			var breaking = moves.Where(m => m.BreaksOwnBarrier).ToList();
			if (breaking.Count > 0)
			{
				var suppressed = breaking.Count < moves.Count;
				return new RollMoves(breaking, suppressed ? "barrier" : null);
			}
		}
		return new RollMoves(moves, null);
	}

	/// <summary>Legal ways to advance any of the player's board pieces by exactly <paramref name="steps"/>.</summary>
	public static List<RaceMoveOption> LegalMoves(
		RaceBoardDef board, RaceRulesConfig rules, RaceState state, string playerId, int steps)
	{
		var seat = SeatOf(state, playerId);
		var seatDef = SeatDefOf(board, state, playerId);
		var barriers = rules.Barriers ? OwnBarriers(state, playerId) : new List<int>();

		var options = new List<RaceMoveOption>();
		for (var i = 0; i < seat.Pieces.Count; i++)
		{
			var piece = seat.Pieces[i];
			if (piece.Location is RacePieceLocation.Home or RacePieceLocation.Goal)
			{
				continue;
			}

			var option = TryWalk(board, rules, state, seat, seatDef, i, steps);
			if (option == null)
			{
				continue;
			}

			options.Add(option with
			{
				BreaksOwnBarrier = piece.Location == RacePieceLocation.Circuit && barriers.Contains(piece.Square),
			});
		}
		return options;
	}

	/// <summary>The exit-home move (onto the seat's start square), or null when blocked.</summary>
	private static RaceMoveOption? ExitOption(
		RaceBoardDef board, RaceState state, RaceSeatState seat, RaceSeatDef seatDef)
	{
		var homeIndex = seat.Pieces.FindIndex(p => p.Location == RacePieceLocation.Home);
		if (homeIndex < 0)
		{
			return null;
		}

		var occupants = CircuitOccupants(state, seatDef.StartSquare);
		var mine = occupants.Count(o => o.Seat.PlayerId == seat.PlayerId);
		var theirs = occupants.Where(o => o.Seat.PlayerId != seat.PlayerId).ToList();

		// Two own pieces on the start = my own barrier: I can't exit onto it.
		if (mine >= 2)
		{
			return null;
		}
		// One of mine + an opponent: the square is full and the opponent shares a safe square
		// with me already — exiting would exceed the two-piece limit even after a capture? No:
		// exiting CAPTURES one opponent (the exit exception), freeing the spot.
		var captures = theirs.Count > 0;
		// After a capture there is room iff current occupancy minus one captured is <= 1.
		if (occupants.Count - (captures ? 1 : 0) >= 2)
		{
			return null;
		}

		return new RaceMoveOption
		{
			PieceIndex = homeIndex,
			ToLocation = RacePieceLocation.Circuit,
			ToSquare = seatDef.StartSquare,
			ExitsHome = true,
			CapturesPlayerId = captures ? theirs[0].Seat.PlayerId : null,
		};
	}

	/// <summary>
	/// Walks one piece <paramref name="steps"/> squares, honouring the forced turn into the own
	/// corridor, barrier blockage on the way, the exact-count goal and destination occupancy.
	/// Returns the move, or null when illegal.
	/// </summary>
	private static RaceMoveOption? TryWalk(
		RaceBoardDef board, RaceRulesConfig rules, RaceState state,
		RaceSeatState seat, RaceSeatDef seatDef, int pieceIndex, int steps)
	{
		var piece = seat.Pieces[pieceIndex];
		var location = piece.Location;
		var square = piece.Square;

		for (var step = 1; step <= steps; step++)
		{
			// One square forward.
			if (location == RacePieceLocation.Circuit)
			{
				if (square == seatDef.CorridorEntry)
				{
					location = RacePieceLocation.Corridor;
					square = 1;
				}
				else
				{
					square = square % board.CircuitLength + 1;
				}
			}
			else // Corridor
			{
				if (square == board.CorridorLength)
				{
					// Stepping past the last corridor square reaches the goal — but only as
					// the FINAL step (exact count).
					if (step != steps)
					{
						return null;
					}

					location = RacePieceLocation.Goal;
					square = 0;
					break;
				}
				square += 1;
			}

			var isFinal = step == steps;
			if (location == RacePieceLocation.Circuit)
			{
				if (!isFinal)
				{
					// Passing through: blocked by any barrier (own or rival).
					if (rules.Barriers && HasBarrier(state, square))
					{
						return null;
					}
				}
			}
			else if (location == RacePieceLocation.Corridor)
			{
				// Passing through (or onto) a corridor square with two own pieces is blocked.
				if (!isFinal && rules.Barriers && CorridorOccupants(seat, square) >= 2)
				{
					return null;
				}
			}
		}

		// Destination legality.
		if (location == RacePieceLocation.Goal)
		{
			return new RaceMoveOption { PieceIndex = pieceIndex, ToLocation = location, ToSquare = 0 };
		}

		if (location == RacePieceLocation.Corridor)
		{
			if (CorridorOccupants(seat, square) >= 2)
			{
				return null; // full
			}

			return new RaceMoveOption { PieceIndex = pieceIndex, ToLocation = location, ToSquare = square };
		}

		// Circuit destination.
		var occupants = CircuitOccupants(state, square)
			.Where(o => !(o.Seat.PlayerId == seat.PlayerId && o.PieceIndex == pieceIndex)) // not myself
			.ToList();
		var rivals = occupants.Where(o => o.Seat.PlayerId != seat.PlayerId).ToList();
		var own = occupants.Count - rivals.Count;
		var safe = board.SafeSquares.Contains(square);

		if (occupants.Count >= 2)
		{
			return null;                    // squares hold two pieces at most
		}

		if (own == 1 && rivals.Count == 0)
		{
			// Lands next to an own piece: forms a barrier.
			return new RaceMoveOption { PieceIndex = pieceIndex, ToLocation = location, ToSquare = square };
		}
		if (rivals.Count == 1)
		{
			if (safe)
			{
				// Coexist on a safe square.
				return new RaceMoveOption { PieceIndex = pieceIndex, ToLocation = location, ToSquare = square };
			}
			// Teams mode: your partner can never be captured, and on a normal square two
			// colours cannot coexist either — so the landing simply is not a legal move.
			if (AreTeammates(board, state, seat.PlayerId, rivals[0].Seat.PlayerId))
			{
				return null;
			}

			return new RaceMoveOption
			{
				PieceIndex = pieceIndex,
				ToLocation = location,
				ToSquare = square,
				CapturesPlayerId = rivals[0].Seat.PlayerId,
			};
		}
		return new RaceMoveOption { PieceIndex = pieceIndex, ToLocation = location, ToSquare = square };
	}

	// ── applying a move ──────────────────────────────────────────────────────

	/// <summary>Applies a legal move to the state and reports what happened.</summary>
	public static RaceMoveResult ApplyMove(RaceState state, string playerId, RaceMoveOption move)
	{
		var seat = SeatOf(state, playerId);
		var piece = seat.Pieces[move.PieceIndex];

		string? capturedPlayer = null;
		if (move.CapturesPlayerId != null)
		{
			// Send home ONE piece of the captured player standing on the destination.
			var victimSeat = SeatOf(state, move.CapturesPlayerId);
			var victim = victimSeat.Pieces.First(p =>
				p.Location == RacePieceLocation.Circuit && p.Square == move.ToSquare);
			victim.Location = RacePieceLocation.Home;
			victim.Square = 0;
			capturedPlayer = move.CapturesPlayerId;
		}

		piece.Location = move.ToLocation;
		piece.Square = move.ToSquare;
		state.LastMovedPieceIndex = move.PieceIndex;

		var reachedGoal = move.ToLocation == RacePieceLocation.Goal;
		var finished = reachedGoal && seat.Pieces.All(p => p.Location == RacePieceLocation.Goal);
		var formedBarrier = move.ToLocation == RacePieceLocation.Circuit
			&& seat.Pieces.Count(p => p.Location == RacePieceLocation.Circuit && p.Square == move.ToSquare) == 2;

		return new RaceMoveResult
		{
			Move = move,
			CapturedPlayerId = capturedPlayer,
			ReachedGoal = reachedGoal,
			FormedBarrier = formedBarrier,
			PlayerFinished = finished,
		};
	}

	/// <summary>
	/// The three-sixes penalty: the last piece the player moved this turn returns home —
	/// unless it already left the circuit (corridor/goal pieces are spared, classic rule).
	/// Returns the punished piece index, or null when nothing could be punished.
	/// </summary>
	public static int? ApplyThreeSixesPenalty(RaceState state, string playerId)
	{
		var seat = SeatOf(state, playerId);
		var index = state.LastMovedPieceIndex;
		if (index is not { } i || i < 0 || i >= seat.Pieces.Count)
		{
			return null;
		}

		var piece = seat.Pieces[i];
		if (piece.Location != RacePieceLocation.Circuit)
		{
			return null;
		}

		piece.Location = RacePieceLocation.Home;
		piece.Square = 0;
		return i;
	}

	/// <summary>Fresh per-player state for a new game (all pieces at home).</summary>
	public static RaceState CreateInitialState(RaceBoardDef board, IReadOnlyList<(string PlayerId, string SeatId)> seating)
		=> new()
		{
			Seats = seating.Select(s => new RaceSeatState
			{
				PlayerId = s.PlayerId,
				SeatId = s.SeatId,
				Pieces = Enumerable.Range(0, board.PiecesPerPlayer).Select(_ => new RacePiece()).ToList(),
			}).ToList(),
		};

	/// <summary>Teams mode: partners sit on OPPOSITE seats — the same parity of the seat's
	/// index in the board's seat list (0&amp;2 vs 1&amp;3 on the classic four-seat ring).</summary>
	public static bool AreTeammates(RaceBoardDef board, RaceState state, string playerA, string playerB)
	{
		if (!state.TeamsMode || playerA == playerB)
		{
			return false;
		}

		int Index(string pid)
		{
			var seatId = state.Seats.FirstOrDefault(s => s.PlayerId == pid)?.SeatId;
			return board.Seats.FindIndex(s => s.Id == seatId);
		}
		var (a, b) = (Index(playerA), Index(playerB));
		return a >= 0 && b >= 0 && a % 2 == b % 2;
	}

	/// <summary>The teammate of a player in teams mode, or null (no teams / no partner seated).</summary>
	public static string? TeammateOf(RaceBoardDef board, RaceState state, string playerId)
		=> state.TeamsMode
			? state.Seats.Select(s => s.PlayerId).FirstOrDefault(p => AreTeammates(board, state, playerId, p))
			: null;

	/// <summary>True when every piece of this player's seat stands on the goal.</summary>
	public static bool SeatFinished(RaceState state, string playerId)
		=> SeatOf(state, playerId).Pieces.All(p => p.Location == RacePieceLocation.Goal);

	/// <summary>
	/// Resolves who sits where: players who picked a seat in the lobby keep it (the lobby
	/// enforced exclusivity; a stale or unknown choice degrades to no preference), and the
	/// rest take the remaining board seats in the given (turn) order.
	/// </summary>
	public static List<(string PlayerId, RaceSeatDef Seat)> AssignSeats(
		RaceBoardDef board, IReadOnlyList<(string PlayerId, string? SeatId)> players)
	{
		var chosen = new Dictionary<string, RaceSeatDef>();
		foreach (var (playerId, seatId) in players)
		{
			var seat = board.Seats.FirstOrDefault(s => s.Id == seatId);
			if (seat != null && !chosen.ContainsValue(seat))
			{
				chosen[playerId] = seat;
			}
		}
		var free = new Queue<RaceSeatDef>(board.Seats.Where(s => !chosen.ContainsValue(s)));
		return players
			.Select(p => (p.PlayerId, chosen.TryGetValue(p.PlayerId, out var seat) ? seat : free.Dequeue()))
			.ToList();
	}
}
