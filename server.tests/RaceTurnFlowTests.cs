using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The race turn flow on top of the pure rulebook: auto-move with one option, pending choice
/// with several (resolved by MoveRacePieceHandler), capture-bonus chaining, extra roll on the
/// extra-roll value, three-sixes losing the turn, and plain rolls passing the turn.
/// </summary>
public class RaceTurnFlowTests
{
	private static RaceBoardDef Board() => new()
	{
		CircuitLength = 20,
		CorridorLength = 3,
		PiecesPerPlayer = 2,
		SafeSquares = new List<int> { 1, 11 },
		Seats = new List<RaceSeatDef>
		{
			new() { Id = "sa", StartSquare = 1, CorridorEntry = 20 },
			new() { Id = "sb", StartSquare = 11, CorridorEntry = 10 },
		},
	};

	private static (GameState State, GameContext Ctx) Game(RaceRulesConfig? rules = null)
	{
		var board = Board();
		var players = new[] { TestFixtures.NewPlayer("A"), TestFixtures.NewPlayer("B") };
		var state = TestFixtures.NewState(players);
		state.GameType = "race";
		state.Race = RaceRulebook.CreateInitialState(board, new[] { ("A", "sa"), ("B", "sb") });
		state.CurrentTurn = "A";
		var ctx = TestFixtures.NewContext(state, raceBoard: board, raceRules: rules ?? new RaceRulesConfig());
		return (state, ctx);
	}

	private static RacePiece Piece(GameState st, string player, int i)
		=> st.Race!.Seats.First(s => s.PlayerId == player).Pieces[i];

	[Fact]
	public async Task Rolling_the_exit_value_exits_automatically_and_passes_the_turn()
	{
		var (state, ctx) = Game();

		var response = await RaceTurnFlow.ProcessRollAsync(5, state.Players[0], ctx);

		Assert.IsType<RaceRollResponse>(response);
		Assert.Equal(RacePieceLocation.Circuit, Piece(state, "A", 0).Location);
		Assert.Equal(1, Piece(state, "A", 0).Square);
		Assert.Equal("B", state.CurrentTurn); // 5 is not the extra-roll value → turn passes
		Assert.Contains(TestFixtures.Announcer(ctx).Sent, d => d.Key == "game.race_exited");
	}

	[Fact]
	public async Task No_legal_move_passes_the_turn_with_an_announcement()
	{
		var (state, ctx) = Game();

		await RaceTurnFlow.ProcessRollAsync(3, state.Players[0], ctx); // everything home, no exit

		Assert.Equal("B", state.CurrentTurn);
		Assert.Contains(TestFixtures.Announcer(ctx).Sent, d => d.Key == "game.race_no_move");
	}

	[Fact]
	public async Task Two_movable_pieces_leave_a_pending_choice_the_handler_resolves()
	{
		var (state, ctx) = Game();
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 2;
		Piece(state, "A", 1).Location = RacePieceLocation.Circuit; Piece(state, "A", 1).Square = 5;

		var roll = Assert.IsType<RaceRollResponse>(await RaceTurnFlow.ProcessRollAsync(3, state.Players[0], ctx));
		Assert.True(roll.RequiresChoice);
		Assert.Equal(2, state.Race!.PendingMove!.Options.Count);
		Assert.Equal("A", state.CurrentTurn); // the turn waits for the choice

		var move = await new MoveRacePieceHandler().HandleAsync(
			new MoveRacePieceCommand { PlayerId = "A", PieceIndex = 1 }, ctx);

		Assert.IsType<RaceMoveResponse>(move);
		Assert.Equal(8, Piece(state, "A", 1).Square);
		Assert.Null(state.Race.PendingMove);
		Assert.Equal("B", state.CurrentTurn);
	}

	[Fact]
	public async Task A_capture_chains_its_bonus_move()
	{
		var (state, ctx) = Game();
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 2;
		Piece(state, "A", 1).Location = RacePieceLocation.Goal;    // keep it out of the way
		Piece(state, "B", 0).Location = RacePieceLocation.Circuit; Piece(state, "B", 0).Square = 5;

		await RaceTurnFlow.ProcessRollAsync(3, state.Players[0], ctx); // lands on B → capture → +20

		Assert.Equal(RacePieceLocation.Home, Piece(state, "B", 0).Location);
		// The +20 bonus was auto-played with the only movable piece: 5 + 20 → wraps to 5 on a 20-circuit.
		var captured = TestFixtures.Announcer(ctx).Sent.Single(d => d.Key == "game.race_captured");
		Assert.Equal("capture", captured.Vars["visualKind"]);
		Assert.Equal("A", captured.Vars["visualSourcePlayerId"]);
		Assert.Equal("B", captured.Vars["visualTargetPlayerId"]);
		Assert.Equal(5, Piece(state, "A", 0).Square); // 5 + 20 = 25 → 25-20 = 5
		Assert.Equal("B", state.CurrentTurn);
	}

	[Fact]
	public async Task A_capture_from_a_choice_offers_FRESH_bonus_options()
	{
		// Field report: after choosing a capturing move, the bonus dialog showed the
		// PREVIOUS roll's options again. The bonus PendingMove must carry NEW options.
		// (Bonus of 4 — a 20 on this 20-square test circuit always overshoots the
		// forced corridor turn and would be lost, which is itself correct.)
		var (state, ctx) = Game(new RaceRulesConfig { CaptureBonus = 4 });
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 2;
		Piece(state, "A", 1).Location = RacePieceLocation.Circuit; Piece(state, "A", 1).Square = 10;
		Piece(state, "B", 0).Location = RacePieceLocation.Circuit; Piece(state, "B", 0).Square = 5;

		// Roll 3: piece 0 can capture at 5, piece 1 moves to 13 → a 2-option choice.
		var roll = Assert.IsType<RaceRollResponse>(await RaceTurnFlow.ProcessRollAsync(3, state.Players[0], ctx));
		Assert.True(roll.RequiresChoice);
		var first = state.Race!.PendingMove!;
		Assert.Equal(3, first.Steps);
		Assert.Contains(first.Options, o => o.CapturesPlayerId == "B");

		// Choose the capture → +20 bonus with BOTH pieces movable → a SECOND choice.
		await new MoveRacePieceHandler().HandleAsync(
			new MoveRacePieceCommand { PlayerId = "A", PieceIndex = 0 }, ctx);

		var bonus = state.Race.PendingMove;
		Assert.NotNull(bonus);
		Assert.Equal(4, bonus!.Steps);
		Assert.Equal("captureBonus", bonus.Kind);
		// Fresh 4-step destinations — NOT the roll's 3-step ones, and no stale capture.
		Assert.Equal(2, bonus.Options.Count);
		Assert.All(bonus.Options, o => Assert.Null(o.CapturesPlayerId)); // B's piece is home now
		Assert.Contains(bonus.Options, o => o.PieceIndex == 0 && o.ToSquare == 9);   // 5 + 4
		Assert.Contains(bonus.Options, o => o.PieceIndex == 1 && o.ToSquare == 14);  // 10 + 4
	}

	[Fact]
	public async Task The_extra_roll_value_keeps_the_turn()
	{
		var (state, ctx) = Game();
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 2;
		Piece(state, "A", 1).Location = RacePieceLocation.Goal;

		var roll = Assert.IsType<RaceRollResponse>(await RaceTurnFlow.ProcessRollAsync(6, state.Players[0], ctx));

		Assert.Equal("A", state.CurrentTurn); // rolls again
		Assert.Equal(1, state.Race!.ConsecutiveSixes);
		// With no piece home, the 6 moved 7 (classic).
		Assert.Equal(9, Piece(state, "A", 0).Square);
		Assert.False(roll.TurnEnded);
	}

	[Fact]
	public async Task A_mandatory_exit_that_locks_board_pieces_is_explained()
	{
		// Field question: "I was on a safe square and could not move that piece -- why?"
		// Because a rolled 5 with pieces at home forces the exit. The obligation is voiced.
		var (state, ctx) = Game();
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 6;
		// piece 1 stays home: rolling 5 forces the exit, locking the circuit piece.

		await RaceTurnFlow.ProcessRollAsync(5, state.Players[0], ctx);

		Assert.Contains(TestFixtures.Announcer(ctx).Sent, d => d.Key == "game.race_forced_exit");
		Assert.Contains(TestFixtures.Announcer(ctx).Sent, d => d.Key == "game.race_exited");
	}

	[Fact]
	public async Task A_natural_exit_with_nothing_else_movable_is_not_lectured()
	{
		var (state, ctx) = Game(); // everything at home: the exit locks nothing

		await RaceTurnFlow.ProcessRollAsync(5, state.Players[0], ctx);

		Assert.DoesNotContain(TestFixtures.Announcer(ctx).Sent, d => d.Key == "game.race_forced_exit");
	}

	[Fact]
	public async Task A_forced_barrier_opening_that_locks_a_free_piece_is_explained()
	{
		var (state, ctx) = Game();
		var seat = RaceRulebook.SeatOf(state.Race!, "A");
		// The free piece lands on an EMPTY square (14 + 6 = 20): it could move, so the
		// barrier obligation genuinely locks it. (From 2 it would land on the barrier
		// itself and never count as movable.)
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 14;
		Piece(state, "A", 1).Location = RacePieceLocation.Circuit; Piece(state, "A", 1).Square = 8;
		seat.Pieces.Add(new RacePiece { Location = RacePieceLocation.Circuit, Square = 8 }); // barrier

		await RaceTurnFlow.ProcessRollAsync(6, state.Players[0], ctx);

		Assert.Contains(TestFixtures.Announcer(ctx).Sent, d => d.Key == "game.race_forced_barrier");
	}

	[Fact]
	public async Task Three_consecutive_sixes_lose_the_turn_and_send_the_piece_home()
	{
		var (state, ctx) = Game();
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 2;
		Piece(state, "A", 1).Location = RacePieceLocation.Goal;
		state.Race!.ConsecutiveSixes = 2;
		state.Race.LastMovedPieceIndex = 0;

		var roll = Assert.IsType<RaceRollResponse>(await RaceTurnFlow.ProcessRollAsync(6, state.Players[0], ctx));

		Assert.True(roll.TurnEnded);
		Assert.Equal(RacePieceLocation.Home, Piece(state, "A", 0).Location);
		Assert.Equal("B", state.CurrentTurn);
		Assert.Contains(TestFixtures.Announcer(ctx).Sent, d => d.Key == "game.race_three_sixes");
	}

	// The client's announcement gate only arms on a Move-phase line and paces every
	// Resolve-phase line to the piece animation (see DiceRollPhaseTests for the property
	// family). The roll, the mandate that explains it and the movement lines are the CAUSE
	// of the motion, so they carry Move; consequences (captures, the next turn…) keep the
	// default Resolve so they are spoken only after the piece visibly lands.

	[Fact]
	public async Task The_roll_and_its_movement_carry_the_move_phase_and_the_turn_change_resolves()
	{
		var (state, ctx) = Game();

		await RaceTurnFlow.ProcessRollAsync(5, state.Players[0], ctx); // auto-exit, turn passes

		var sent = TestFixtures.Announcer(ctx).Sent;
		var movement = sent.Where(a => a.Key.StartsWith("game.race_rolled") || a.Key.StartsWith("game.race_exited")).ToList();
		Assert.NotEmpty(movement);
		Assert.All(movement, a => Assert.Equal(AnnouncementPhase.Move, a.Phase));
		var turn = sent.Where(a => a.Key.StartsWith("game.turn_of")).ToList();
		Assert.NotEmpty(turn);
		Assert.All(turn, a => Assert.Equal(AnnouncementPhase.Resolve, a.Phase));
	}

	[Fact]
	public async Task A_resolved_piece_choice_still_opens_with_a_move_phase_line()
	{
		// The choice arrives as its own action with NO roll line, so the movement line is
		// the only thing that can arm the client's gate — without it the turn change is
		// voiced the instant the choice is confirmed, before the piece has visibly moved.
		var (state, ctx) = Game();
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 2;
		Piece(state, "A", 1).Location = RacePieceLocation.Circuit; Piece(state, "A", 1).Square = 5;
		await RaceTurnFlow.ProcessRollAsync(3, state.Players[0], ctx);
		var before = TestFixtures.Announcer(ctx).Sent.Count;

		await new MoveRacePieceHandler().HandleAsync(
			new MoveRacePieceCommand { PlayerId = "A", PieceIndex = 1 }, ctx);

		var choiceLines = TestFixtures.Announcer(ctx).Sent.Skip(before).ToList();
		var moved = choiceLines.Where(a => a.Key.StartsWith("game.race_moved")).ToList();
		Assert.NotEmpty(moved);
		Assert.All(moved, a => Assert.Equal(AnnouncementPhase.Move, a.Phase));
		var turn = choiceLines.Where(a => a.Key.StartsWith("game.turn_of")).ToList();
		Assert.NotEmpty(turn);
		Assert.All(turn, a => Assert.Equal(AnnouncementPhase.Resolve, a.Phase));
	}

	[Fact]
	public async Task A_fresh_barrier_and_a_safe_landing_are_voiced_as_consequences()
	{
		var (state, ctx) = Game();
		// Second exit onto the salida (already holding a piece) forms a barrier there.
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 1;
		await RaceTurnFlow.ProcessRollAsync(5, state.Players[0], ctx);
		var sent = TestFixtures.Announcer(ctx).Sent;
		Assert.Contains(sent, a => a.Key == "game.race_barrier_formed" && a.Phase == AnnouncementPhase.Resolve);
		// Exits never voice the safe line: every salida is safe by definition.
		Assert.DoesNotContain(sent, a => a.Key == "game.race_landed_safe");
	}

	[Fact]
	public async Task Landing_on_a_mid_circuit_safe_square_is_voiced()
	{
		var (state, ctx) = Game(); // safes: 1 and 11
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 8;
		Piece(state, "A", 1).Location = RacePieceLocation.Goal;

		await RaceTurnFlow.ProcessRollAsync(3, state.Players[0], ctx); // 8 + 3 → 11 (safe)

		var sent = TestFixtures.Announcer(ctx).Sent;
		Assert.Contains(sent, a => a.Key == "game.race_landed_safe");
		Assert.DoesNotContain(sent, a => a.Key == "game.race_barrier_formed");
	}

	// ── Lobby seat choices: choosers keep their seat, the rest fill in turn order ──

	[Fact]
	public void AssignSeats_honours_choices_and_hands_free_seats_in_order()
	{
		var board = Board(); // seats: sa, sb
		var assigned = RaceRulebook.AssignSeats(board, new (string, string?)[]
		{
			("A", "sb"),   // A chose the SECOND seat
            ("B", null),   // B left it to fate
        });

		Assert.Equal("sb", assigned.Single(a => a.PlayerId == "A").Seat.Id);
		Assert.Equal("sa", assigned.Single(a => a.PlayerId == "B").Seat.Id);
	}

	[Fact]
	public void AssignSeats_degrades_stale_or_duplicate_choices_to_no_preference()
	{
		var board = Board();
		var assigned = RaceRulebook.AssignSeats(board, new (string, string?)[]
		{
			("A", "nope"), // unknown seat id (e.g. a stale client) → first free
            ("B", "sb"),
		});
		Assert.Equal("sa", assigned.Single(a => a.PlayerId == "A").Seat.Id);
		Assert.Equal("sb", assigned.Single(a => a.PlayerId == "B").Seat.Id);

		var duplicated = RaceRulebook.AssignSeats(board, new (string, string?)[]
		{
			("A", "sb"),
			("B", "sb"), // the lobby prevents this; if it slips through, first-come keeps it
        });
		Assert.Equal("sb", duplicated.Single(a => a.PlayerId == "A").Seat.Id);
		Assert.Equal("sa", duplicated.Single(a => a.PlayerId == "B").Seat.Id);
	}

	// ── Classic pairs: opposite seats team up (sa&sc vs sb&sd on the 4-seat board) ──

	private static (GameState State, GameContext Ctx) Game4Teams()
	{
		var (state, ctx) = Game4();
		state.Race = state.Race! with { TeamsMode = true };
		return (state, ctx);
	}

	private static void AllToGoal(GameState st, string player)
	{
		foreach (var piece in st.Race!.Seats.First(s => s.PlayerId == player).Pieces)
		{
			piece.Location = RacePieceLocation.Goal; piece.Square = 0;
		}
	}

	[Fact]
	public async Task Your_partner_cannot_be_captured_nor_landed_on_outside_a_safe()
	{
		var (state, ctx) = Game4Teams();
		var runtime = ctx.Family<RaceRuntime>();
		var board = runtime.Board;
		var race = state.Race!;
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 2;
		Piece(state, "A", 1).Location = RacePieceLocation.Goal;
		Piece(state, "C", 0).Location = RacePieceLocation.Circuit; Piece(state, "C", 0).Square = 4; // partner, non-safe

		Assert.Empty(RaceRulebook.LegalMoves(board, runtime.Rules, race, "A", 2));

		// The same landing on a RIVAL still captures…
		Piece(state, "C", 0).Location = RacePieceLocation.Home; Piece(state, "C", 0).Square = 0;
		Piece(state, "B", 0).Location = RacePieceLocation.Circuit; Piece(state, "B", 0).Square = 4;
		var capture = Assert.Single(RaceRulebook.LegalMoves(board, runtime.Rules, race, "A", 2));
		Assert.Equal("B", capture.CapturesPlayerId);

		// …and partners coexist on a SAFE square (6) like any two colours.
		Piece(state, "B", 0).Location = RacePieceLocation.Home; Piece(state, "B", 0).Square = 0;
		Piece(state, "C", 0).Location = RacePieceLocation.Circuit; Piece(state, "C", 0).Square = 6;
		Piece(state, "A", 0).Square = 4;
		var coexist = Assert.Single(RaceRulebook.LegalMoves(board, runtime.Rules, race, "A", 2));
		Assert.Null(coexist.CapturesPlayerId);
		Assert.Equal(6, coexist.ToSquare);
	}

	[Fact]
	public async Task A_finished_player_rolls_for_their_partner_and_stays_in_the_rotation()
	{
		var (state, ctx) = Game4Teams();
		AllToGoal(state, "A"); // my seat is complete — no FinishPlace in teams mode
		Piece(state, "C", 0).Location = RacePieceLocation.Circuit; Piece(state, "C", 0).Square = 2;
		state.CurrentTurn = "A";

		await RaceTurnFlow.ProcessRollAsync(1, state.Players[0], ctx);

		Assert.Equal(3, Piece(state, "C", 0).Square); // A's roll moved the PARTNER's piece
		Assert.Equal(0, state.Players[0].FinishPlace); // no individual place in teams mode
		Assert.Equal("B", state.CurrentTurn);
	}

	[Fact]
	public async Task Finishing_your_own_seat_hands_the_goal_bonus_to_your_partner()
	{
		var (state, ctx) = Game4Teams();
		Piece(state, "A", 0).Location = RacePieceLocation.Goal;
		Piece(state, "A", 1).Location = RacePieceLocation.Corridor; Piece(state, "A", 1).Square = 3;
		Piece(state, "C", 0).Location = RacePieceLocation.Circuit; Piece(state, "C", 0).Square = 2;
		state.CurrentTurn = "A";

		await RaceTurnFlow.ProcessRollAsync(1, state.Players[0], ctx); // corridor 3 + 1 → goal

		var sent = TestFixtures.Announcer(ctx).Sent;
		Assert.Contains(sent, a => a.Key == "game.race_finished_team");
		Assert.DoesNotContain(sent, a => a.Key.StartsWith("game.race_won"));
		// The count-10 played with the PARTNER's counter: 2 + 10 steps crosses their
		// corridor entry (10) and walks two cells inside — circuit 2 → corridor 2.
		Assert.Equal(RacePieceLocation.Corridor, Piece(state, "C", 0).Location);
		Assert.Equal(2, Piece(state, "C", 0).Square);
		Assert.Equal(0, state.Players[0].FinishPlace);
		Assert.False(state.IsGameOver);
	}

	[Fact]
	public async Task Completing_the_partners_seat_wins_as_a_team()
	{
		var (state, ctx) = Game4Teams();
		AllToGoal(state, "A");
		Piece(state, "C", 0).Location = RacePieceLocation.Corridor; Piece(state, "C", 0).Square = 3;
		Piece(state, "C", 1).Location = RacePieceLocation.Goal;
		state.CurrentTurn = "A";

		await RaceTurnFlow.ProcessRollAsync(1, state.Players[0], ctx); // A moves C's last piece home

		Assert.True(state.IsGameOver);
		Assert.Equal(1, state.Players[0].FinishPlace); // A
		Assert.Equal(1, state.Players[2].FinishPlace); // C — the winning pair
		Assert.Equal(2, state.Players[1].FinishPlace); // B
		Assert.Equal(2, state.Players[3].FinishPlace); // D
		Assert.Contains(TestFixtures.Announcer(ctx).Sent, a => a.Key == "game.race_team_won");
	}

	// ── Finishing places: the race continues until a single player remains ──────

	private static (GameState State, GameContext Ctx) Game4()
	{
		var board = new RaceBoardDef
		{
			CircuitLength = 20,
			CorridorLength = 3,
			PiecesPerPlayer = 2,
			SafeSquares = new List<int> { 1, 6, 11, 16 },
			Seats = new List<RaceSeatDef>
			{
				new() { Id = "sa", StartSquare = 1, CorridorEntry = 20 },
				new() { Id = "sb", StartSquare = 6, CorridorEntry = 5 },
				new() { Id = "sc", StartSquare = 11, CorridorEntry = 10 },
				new() { Id = "sd", StartSquare = 16, CorridorEntry = 15 },
			},
		};
		var players = new[]
		{
			TestFixtures.NewPlayer("A"), TestFixtures.NewPlayer("B"),
			TestFixtures.NewPlayer("C"), TestFixtures.NewPlayer("D"),
		};
		var state = TestFixtures.NewState(players);
		state.GameType = "race";
		state.Race = RaceRulebook.CreateInitialState(
			board, new[] { ("A", "sa"), ("B", "sb"), ("C", "sc"), ("D", "sd") });
		state.CurrentTurn = "A";
		var ctx = TestFixtures.NewContext(state, raceBoard: board, raceRules: new RaceRulesConfig());
		return (state, ctx);
	}

	/// <summary>Parks every piece of a player on the goal and gives them their place.</summary>
	private static void Finish(GameState st, string player, int place)
	{
		foreach (var piece in st.Race!.Seats.First(s => s.PlayerId == player).Pieces)
		{
			piece.Location = RacePieceLocation.Goal; piece.Square = 0;
		}
		st.Players.First(p => p.Id == player).FinishPlace = place;
	}

	[Fact]
	public async Task A_finisher_takes_the_next_place_and_leaves_the_rotation()
	{
		var (state, ctx) = Game4();
		Finish(state, "A", 1);
		state.WinnerId = "A";
		// B's last piece sits 7 exact steps from the goal (a 6 is worth 7 with none home):
		// 2 → 3 → 4 → 5 (seat sb's corridor entry) → corridor 1..3 → goal.
		Piece(state, "B", 0).Location = RacePieceLocation.Goal;
		Piece(state, "B", 1).Location = RacePieceLocation.Circuit; Piece(state, "B", 1).Square = 2;
		state.CurrentTurn = "B";

		await RaceTurnFlow.ProcessRollAsync(6, state.Players[1], ctx);

		Assert.Equal(2, state.Players[1].FinishPlace);
		Assert.False(state.IsGameOver); // C and D are still racing
		Assert.Equal("C", state.CurrentTurn); // the turn skips finished players
		var sent = TestFixtures.Announcer(ctx).Sent;
		Assert.Contains(sent, a => a.Key == "game.race_finished" && Equals(a.Vars["place"], 2));
		// Their run ends silently: no extra roll for the 6, no "goal bonus lost" noise.
		Assert.DoesNotContain(sent, a => a.Key == "game.race_roll_again");
		Assert.DoesNotContain(sent, a => a.Key == "game.race_bonus_lost");
		Assert.Empty(state.Race!.PendingBonuses);
	}

	[Fact]
	public async Task The_second_to_last_finisher_closes_the_game_and_the_last_takes_last_place()
	{
		var (state, ctx) = Game4();
		Finish(state, "A", 1); state.WinnerId = "A";
		Finish(state, "B", 2);
		Piece(state, "C", 0).Location = RacePieceLocation.Goal;
		Piece(state, "C", 1).Location = RacePieceLocation.Corridor; Piece(state, "C", 1).Square = 3;
		state.CurrentTurn = "C";

		await RaceTurnFlow.ProcessRollAsync(1, state.Players[2], ctx); // corridor 3 + 1 → goal

		Assert.Equal(3, state.Players[2].FinishPlace);
		Assert.Equal(4, state.Players[3].FinishPlace); // D takes the last place implicitly
		Assert.True(state.IsGameOver);
		Assert.Equal("A", state.WinnerId); // the FIRST finisher stays the winner
		Assert.Contains(TestFixtures.Announcer(ctx).Sent, a => a.Key == "game.game_over");
	}

	[Fact]
	public async Task In_a_two_player_race_the_first_finish_still_ends_the_game()
	{
		var (state, ctx) = Game();
		Piece(state, "A", 0).Location = RacePieceLocation.Goal;
		Piece(state, "A", 1).Location = RacePieceLocation.Corridor; Piece(state, "A", 1).Square = 3;

		await RaceTurnFlow.ProcessRollAsync(1, state.Players[0], ctx);

		Assert.Equal(1, state.Players[0].FinishPlace);
		Assert.Equal(2, state.Players[1].FinishPlace);
		Assert.Equal("A", state.WinnerId);
		Assert.True(state.IsGameOver);
		var sent = TestFixtures.Announcer(ctx).Sent;
		Assert.Contains(sent, a => a.Key == "game.race_won");
		Assert.Contains(sent, a => a.Key == "game.game_over");
	}

	[Fact]
	public async Task Capture_and_goal_consequences_resolve_after_the_move_phase_lines()
	{
		var (state, ctx) = Game();
		Piece(state, "A", 0).Location = RacePieceLocation.Circuit; Piece(state, "A", 0).Square = 2;
		Piece(state, "A", 1).Location = RacePieceLocation.Goal;
		Piece(state, "B", 0).Location = RacePieceLocation.Circuit; Piece(state, "B", 0).Square = 5;

		await RaceTurnFlow.ProcessRollAsync(3, state.Players[0], ctx); // capture at 5 + chained bonus

		var sent = TestFixtures.Announcer(ctx).Sent;
		Assert.All(sent.Where(a => a.Key.StartsWith("game.race_captured")),
			a => Assert.Equal(AnnouncementPhase.Resolve, a.Phase));
		Assert.All(sent.Where(a => a.Key.StartsWith("game.race_moved")),
			a => Assert.Equal(AnnouncementPhase.Move, a.Phase));
	}
}
