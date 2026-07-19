using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The pure rules of the "race" family (parcheesi-style), pinned one classic rule at a time:
/// mandatory exit on 5 (which captures on the own start), captures (+ never on safe squares),
/// barriers blocking passage and the 6-must-open obligation, the exact-count corridor/goal,
/// the 6-moves-7 conversion, the three-sixes penalty and the finish condition.
/// </summary>
public class RaceRulebookTests
{
	// A classic-shaped small board: 20-square circuit, 3-square corridors, 2 seats, 2 pieces.
	// Seat A starts at 1 and turns off at 20; seat B starts at 11 and turns off at 10.
	private static RaceBoardDef Board(int pieces = 2) => new()
	{
		CircuitLength = 20,
		CorridorLength = 3,
		PiecesPerPlayer = pieces,
		SafeSquares = new List<int> { 1, 6, 11, 16 },
		Seats = new List<RaceSeatDef>
		{
			new() { Id = "sa", StartSquare = 1, CorridorEntry = 20, NameKey = "seats.sa" },
			new() { Id = "sb", StartSquare = 11, CorridorEntry = 10, NameKey = "seats.sb" },
		},
	};

	private static RaceRulesConfig Rules() => new();

	private static RaceState State(RaceBoardDef board)
		=> RaceRulebook.CreateInitialState(board, new[] { ("A", "sa"), ("B", "sb") });

	private static RacePiece Piece(RaceState st, string player, int index)
		=> RaceRulebook.SeatOf(st, player).Pieces[index];

	private static void Place(RaceState st, string player, int index, RacePieceLocation loc, int square = 0)
	{
		var p = Piece(st, player, index);
		p.Location = loc;
		p.Square = square;
	}

	// ── exiting home ─────────────────────────────────────────────────────────

	[Fact]
	public void Rolling_the_exit_value_with_pieces_at_home_offers_ONLY_the_exit()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 5); // one piece already out

		var moves = RaceRulebook.LegalMovesForRoll(board, Rules(), st, "A", 5);

		var exit = Assert.Single(moves); // the circuit piece may NOT move: exiting is mandatory
		Assert.True(exit.ExitsHome);
		Assert.Equal(RacePieceLocation.Circuit, exit.ToLocation);
		Assert.Equal(1, exit.ToSquare); // seat A's start
	}

	[Fact]
	public void Exiting_captures_an_opponent_sitting_on_the_start_even_though_it_is_safe()
	{
		var board = Board();
		var st = State(board);
		Place(st, "B", 0, RacePieceLocation.Circuit, 1); // opponent camped on A's start (a safe square)

		var exit = Assert.Single(RaceRulebook.LegalMovesForRoll(board, Rules(), st, "A", 5));
		Assert.Equal("B", exit.CapturesPlayerId);

		var result = RaceRulebook.ApplyMove(st, "A", exit);
		Assert.Equal("B", result.CapturedPlayerId);
		Assert.Equal(RacePieceLocation.Home, Piece(st, "B", 0).Location);
		Assert.Equal(RacePieceLocation.Circuit, Piece(st, "A", 0).Location);
	}

	[Fact]
	public void An_own_barrier_on_the_start_blocks_the_exit_and_frees_the_other_pieces()
	{
		var board = Board(pieces: 3);
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 1);
		Place(st, "A", 1, RacePieceLocation.Circuit, 1); // own barrier on the start
														 // piece 2 stays home; a 5 cannot exit, so the circuit pieces move normally instead.

		var moves = RaceRulebook.LegalMovesForRoll(board, Rules(), st, "A", 5);

		Assert.All(moves, m => Assert.False(m.ExitsHome));
		Assert.NotEmpty(moves);
	}

	[Fact]
	public void Bonus_moves_never_exit_home()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 3);
		// LegalMoves (the bonus path) with 5 steps: only the circuit piece, no exit option.
		var moves = RaceRulebook.LegalMoves(board, Rules(), st, "A", 5);

		var move = Assert.Single(moves);
		Assert.False(move.ExitsHome);
		Assert.Equal(8, move.ToSquare);
	}

	// ── captures and safe squares ────────────────────────────────────────────

	[Fact]
	public void Landing_on_a_lone_rival_on_a_normal_square_captures_it()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 2);
		Place(st, "B", 0, RacePieceLocation.Circuit, 5);

		var moves = RaceRulebook.LegalMoves(board, Rules(), st, "A", 3);
		var move = Assert.Single(moves);
		Assert.Equal("B", move.CapturesPlayerId);

		var result = RaceRulebook.ApplyMove(st, "A", move);
		Assert.Equal("B", result.CapturedPlayerId);
		Assert.Equal(RacePieceLocation.Home, Piece(st, "B", 0).Location);
	}

	[Fact]
	public void Landing_on_a_lone_rival_on_a_SAFE_square_coexists()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 3);
		Place(st, "B", 0, RacePieceLocation.Circuit, 6); // 6 is safe

		var move = Assert.Single(RaceRulebook.LegalMoves(board, Rules(), st, "A", 3));
		Assert.Null(move.CapturesPlayerId);

		RaceRulebook.ApplyMove(st, "A", move);
		Assert.Equal(RacePieceLocation.Circuit, Piece(st, "B", 0).Location); // untouched
	}

	[Fact]
	public void A_full_square_cannot_be_landed_on()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 3);
		Place(st, "A", 1, RacePieceLocation.Circuit, 6); // mine
		Place(st, "B", 0, RacePieceLocation.Circuit, 6); // + a rival sharing the safe square = full

		// Piece 0 may not land on the full square 6 (the piece standing ON 6 may still move away).
		var moves = RaceRulebook.LegalMoves(board, Rules(), st, "A", 3);
		Assert.DoesNotContain(moves, m => m.ToSquare == 6);
		Assert.DoesNotContain(moves, m => m.PieceIndex == 0);
	}

	[Fact]
	public void Landing_on_an_own_piece_forms_a_barrier()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 3);
		Place(st, "A", 1, RacePieceLocation.Circuit, 6);

		var moves = RaceRulebook.LegalMoves(board, Rules(), st, "A", 3);
		// Piece 0 → 6 (forms barrier with piece 1); piece 1 → 9.
		Assert.Contains(moves, m => m.PieceIndex == 0 && m.ToSquare == 6);

		RaceRulebook.ApplyMove(st, "A", moves.First(m => m.PieceIndex == 0));
		Assert.Equal(new List<int> { 6 }, RaceRulebook.OwnBarriers(st, "A"));
	}

	// ── barriers block passage ───────────────────────────────────────────────

	[Fact]
	public void A_rival_barrier_blocks_passing_through()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 2);
		Place(st, "B", 0, RacePieceLocation.Circuit, 4);
		Place(st, "B", 1, RacePieceLocation.Circuit, 4); // rival barrier at 4

		// 3 steps would pass over 4 → illegal; 1 step (to 3) is fine.
		Assert.Empty(RaceRulebook.LegalMoves(board, Rules(), st, "A", 3));
		Assert.Single(RaceRulebook.LegalMoves(board, Rules(), st, "A", 1));
	}

	[Fact]
	public void Your_OWN_barrier_blocks_your_other_pieces_too()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 2);
		Place(st, "A", 1, RacePieceLocation.Circuit, 4);
		var extra = RaceRulebook.SeatOf(st, "A");
		extra.Pieces.Add(new RacePiece { Location = RacePieceLocation.Circuit, Square = 4 }); // own barrier at 4

		var moves = RaceRulebook.LegalMoves(board, Rules(), st, "A", 3);
		// Piece 0 cannot pass its own barrier; the barrier pieces themselves may move (2 of them, same move).
		Assert.DoesNotContain(moves, m => m.PieceIndex == 0);
		Assert.All(moves, m => Assert.True(m.BreaksOwnBarrier));
	}

	[Fact]
	public void Rolling_a_6_with_a_barrier_forces_opening_it()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 2);  // a free piece
		Place(st, "A", 1, RacePieceLocation.Circuit, 8);
		var seat = RaceRulebook.SeatOf(st, "A");
		seat.Pieces.Add(new RacePiece { Location = RacePieceLocation.Circuit, Square = 8 }); // barrier at 8

		var moves = RaceRulebook.LegalMovesForRoll(board, Rules(), st, "A", 6);

		Assert.NotEmpty(moves);
		Assert.All(moves, m => Assert.True(m.BreaksOwnBarrier)); // only barrier-opening moves offered
	}

	[Fact]
	public void Rolling_a_6_with_no_barrier_moves_normally()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 2);
		Place(st, "A", 1, RacePieceLocation.Home); // one home piece → 6 stays 6 (not 7)

		var moves = RaceRulebook.LegalMovesForRoll(board, Rules(), st, "A", 6);
		var move = Assert.Single(moves);
		Assert.Equal(8, move.ToSquare);
	}

	// ── the 6 moves 7 conversion ─────────────────────────────────────────────

	[Fact]
	public void A_6_moves_7_when_no_piece_is_at_home()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 2);
		Place(st, "A", 1, RacePieceLocation.Circuit, 12);

		var moves = RaceRulebook.LegalMovesForRoll(board, Rules(), st, "A", 6);
		Assert.Contains(moves, m => m.PieceIndex == 0 && m.ToSquare == 9);   // 2 + 7
		Assert.Contains(moves, m => m.PieceIndex == 1 && m.ToSquare == 19);  // 12 + 7
	}

	// ── corridor and goal (exact count) ──────────────────────────────────────

	[Fact]
	public void A_piece_turns_into_its_own_corridor_instead_of_continuing_the_circuit()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 19); // A turns off at 20

		var move = Assert.Single(RaceRulebook.LegalMoves(board, Rules(), st, "A", 3));
		Assert.Equal(RacePieceLocation.Corridor, move.ToLocation);
		Assert.Equal(2, move.ToSquare); // 19 → 20 → corridor1 → corridor2
	}

	[Fact]
	public void Another_seats_corridor_entry_is_a_plain_circuit_square()
	{
		var board = Board();
		var st = State(board);
		Place(st, "B", 0, RacePieceLocation.Circuit, 19); // B's entry is 10, not 20

		var move = Assert.Single(RaceRulebook.LegalMoves(board, Rules(), st, "B", 3));
		Assert.Equal(RacePieceLocation.Circuit, move.ToLocation);
		Assert.Equal(2, move.ToSquare); // wraps 19 → 20 → 1 → 2
	}

	[Fact]
	public void Reaching_the_goal_requires_the_exact_count()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Corridor, 2); // corridor length 3 → goal is 2 steps away

		var exact = Assert.Single(RaceRulebook.LegalMoves(board, Rules(), st, "A", 2));
		Assert.Equal(RacePieceLocation.Goal, exact.ToLocation);

		Assert.Empty(RaceRulebook.LegalMoves(board, Rules(), st, "A", 3)); // overshoot → illegal
	}

	[Fact]
	public void Bringing_the_last_piece_home_finishes_the_player()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Goal);
		Place(st, "A", 1, RacePieceLocation.Corridor, 3);

		var move = Assert.Single(RaceRulebook.LegalMoves(board, Rules(), st, "A", 1));
		var result = RaceRulebook.ApplyMove(st, "A", move);

		Assert.True(result.ReachedGoal);
		Assert.True(result.PlayerFinished);
	}

	[Fact]
	public void Reaching_the_goal_with_pieces_left_does_not_finish()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Corridor, 3);
		Place(st, "A", 1, RacePieceLocation.Circuit, 5);

		var result = RaceRulebook.ApplyMove(st, "A",
			Assert.Single(RaceRulebook.LegalMoves(board, Rules(), st, "A", 1), m => m.ToLocation == RacePieceLocation.Goal));

		Assert.True(result.ReachedGoal);
		Assert.False(result.PlayerFinished);
	}

	// ── three sixes ──────────────────────────────────────────────────────────

	[Fact]
	public void The_three_sixes_penalty_sends_the_last_moved_circuit_piece_home()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 2);
		var move = Assert.Single(RaceRulebook.LegalMoves(board, Rules(), st, "A", 3));
		RaceRulebook.ApplyMove(st, "A", move);

		var punished = RaceRulebook.ApplyThreeSixesPenalty(st, "A");

		Assert.Equal(0, punished);
		Assert.Equal(RacePieceLocation.Home, Piece(st, "A", 0).Location);
	}

	[Fact]
	public void The_penalty_spares_a_piece_already_in_the_corridor()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Corridor, 1);
		st.LastMovedPieceIndex = 0;

		Assert.Null(RaceRulebook.ApplyThreeSixesPenalty(st, "A"));
		Assert.Equal(RacePieceLocation.Corridor, Piece(st, "A", 0).Location);
	}

	// ── exits happen ONLY on the exit value (field report: "a 4 exited a piece"?) ──

	[Theory]
	[InlineData(1)]
	[InlineData(2)]
	[InlineData(3)]
	[InlineData(4)]
	[InlineData(6)]
	public void No_roll_other_than_the_exit_value_can_leave_home(int rolled)
	{
		var board = Board();
		var st = State(board); // everything at home

		var moves = RaceRulebook.LegalMovesForRoll(board, Rules(), st, "A", rolled);

		Assert.DoesNotContain(moves, m => m.ExitsHome);
		Assert.Empty(moves); // with everything home, a non-exit roll has nothing to do
	}

	[Fact]
	public void With_mixed_pieces_a_4_moves_board_pieces_but_never_exits()
	{
		var board = Board();
		var st = State(board);
		Place(st, "A", 0, RacePieceLocation.Circuit, 2); // piece 1 stays home

		var moves = RaceRulebook.LegalMovesForRoll(board, Rules(), st, "A", 4);

		var move = Assert.Single(moves);
		Assert.False(move.ExitsHome);
		Assert.Equal(6, move.ToSquare);
		Assert.Equal(RacePieceLocation.Home, Piece(st, "A", 1).Location); // untouched
	}

	// ── no legal move ────────────────────────────────────────────────────────

	[Fact]
	public void With_every_piece_home_and_no_exit_roll_there_is_nothing_to_do()
	{
		var board = Board();
		var st = State(board);

		Assert.Empty(RaceRulebook.LegalMovesForRoll(board, Rules(), st, "A", 3));
	}

	[Fact]
	public void Wrapping_around_the_circuit_end_works()
	{
		var board = Board();
		var st = State(board);
		Place(st, "B", 0, RacePieceLocation.Circuit, 19);

		var move = Assert.Single(RaceRulebook.LegalMoves(board, Rules(), st, "B", 4));
		Assert.Equal(3, move.ToSquare); // 19 → 20 → 1 → 2 → 3
	}
}
