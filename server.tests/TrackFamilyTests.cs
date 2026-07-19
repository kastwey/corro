using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The track family (snakes-and-ladders style): the pure rulebook (walk, bounce, effect
/// chains, the win) and the turn flow on top (announcement phases, themed effect lines by
/// direction, placings shared with the race family).
/// </summary>
public class TrackFamilyTests
{
	private static TrackBoardDef Board() => new()
	{
		TrackLength = 30,
		GridWidth = 6,
		Effects = new List<TrackEffectDef>
		{
			new() { From = 3, To = 12, Kind = "ladder" },
			new() { From = 15, To = 6, Kind = "snake" },
            // A chain: the ladder at 20 drops you on the snake at 25.
            new() { From = 20, To = 25, Kind = "ladder" },
			new() { From = 25, To = 10, Kind = "snake" },
		},
	};

	private static (GameState State, GameContext Ctx) Game(TrackRulesConfig? rules = null)
	{
		var board = Board();
		var players = new[] { TestFixtures.NewPlayer("A"), TestFixtures.NewPlayer("B") };
		var state = TestFixtures.NewState(players);
		state.GameType = "track";
		state.Track = TrackRulebook.CreateInitialState(new[] { "A", "B" });
		state.TrackBoard = board;
		state.CurrentTurn = "A";
		var ctx = TestFixtures.NewContext(state, trackBoard: board, trackRules: rules ?? new TrackRulesConfig());
		return (state, ctx);
	}

	private static int Pos(GameState st, string player)
		=> st.Track!.Positions.First(p => p.PlayerId == player).Square;

	// ── rulebook ─────────────────────────────────────────────────────────────

	[Fact]
	public void A_plain_walk_moves_the_piece_from_off_board()
	{
		var board = Board();
		var track = TrackRulebook.CreateInitialState(new[] { "A" });

		var result = TrackRulebook.Move(board, new TrackRulesConfig(), track, "A", 4);

		Assert.Equal(0, result.From);
		Assert.Equal(4, result.Final);
		Assert.Empty(result.EffectsApplied);
	}

	[Fact]
	public void Landing_on_an_effect_teleports_and_chains_until_a_plain_square()
	{
		var board = Board();
		var track = TrackRulebook.CreateInitialState(new[] { "A" });
		TrackRulebook.PositionOf(track, "A").Square = 18;

		var result = TrackRulebook.Move(board, new TrackRulesConfig(), track, "A", 2); // 20 → 25 → 10

		Assert.Equal(20, result.Landed);
		Assert.Equal(2, result.EffectsApplied.Count);
		Assert.Equal(10, result.Final);
	}

	[Fact]
	public void An_authoring_cycle_in_the_effects_stops_instead_of_looping()
	{
		var board = new TrackBoardDef
		{
			TrackLength = 30,
			GridWidth = 6,
			Effects = new List<TrackEffectDef>
			{
				new() { From = 5, To = 9, Kind = "ladder" },
				new() { From = 9, To = 5, Kind = "snake" }, // 5 → 9 → 5 → …
            },
		};
		var track = TrackRulebook.CreateInitialState(new[] { "A" });

		var result = TrackRulebook.Move(board, new TrackRulesConfig(), track, "A", 5);

		Assert.Equal(2, result.EffectsApplied.Count); // each edge once, then stop
		Assert.Equal(5, result.Final);
	}

	[Fact]
	public void Overshooting_the_end_bounces_back_the_excess()
	{
		var board = Board();
		var track = TrackRulebook.CreateInitialState(new[] { "A" });
		TrackRulebook.PositionOf(track, "A").Square = 28;

		var result = TrackRulebook.Move(board, new TrackRulesConfig(), track, "A", 5); // 33 → bounce to 27

		Assert.True(result.Bounced);
		Assert.Equal(27, result.Final);
		Assert.False(result.Won);
	}

	[Fact]
	public void The_stay_variant_loses_the_overshooting_move()
	{
		var board = Board();
		var track = TrackRulebook.CreateInitialState(new[] { "A" });
		TrackRulebook.PositionOf(track, "A").Square = 28;

		var result = TrackRulebook.Move(board, new TrackRulesConfig { ExactFinish = "stay" }, track, "A", 5);

		Assert.Equal(28, result.Final);
		Assert.False(result.Bounced);
	}

	[Fact]
	public void Reaching_the_final_square_exactly_wins()
	{
		var board = Board();
		var track = TrackRulebook.CreateInitialState(new[] { "A" });
		TrackRulebook.PositionOf(track, "A").Square = 27;

		var result = TrackRulebook.Move(board, new TrackRulesConfig(), track, "A", 3);

		Assert.True(result.Won);
		Assert.Equal(30, result.Final);
	}

	// ── turn flow ────────────────────────────────────────────────────────────

	[Fact]
	public async Task Effects_ship_as_their_own_turn_segments_with_move_phase_lines()
	{
		var (state, ctx) = Game();
		state.Track!.Positions.First(p => p.PlayerId == "A").Square = 13;

		await TrackTurnFlow.ProcessRollAsync(2, state.Players[0], ctx); // 15 → snake → 6

		var sent = TestFixtures.Announcer(ctx).Sent;
		Assert.All(sent.Where(a => a.Key.StartsWith("game.track_rolled") || a.Key.StartsWith("game.track_moved")),
			a => Assert.Equal(AnnouncementPhase.Move, a.Phase));
		// The slide is its own SEGMENT (the piece visibly stops on the snake's mouth
		// first), and its line is that segment's CAUSE:
		// Move phase, spoken as the slide starts.
		var down = sent.Where(a => a.Key.StartsWith("game.track_effect_down")).ToList();
		Assert.NotEmpty(down);
		Assert.All(down, a => Assert.Equal(AnnouncementPhase.Move, a.Phase));
		Assert.Equal(1, TestFixtures.Presenter(ctx).CheckpointCount); // one checkpoint per effect hop
		Assert.Equal(6, Pos(state, "A"));
		Assert.Equal("B", state.CurrentTurn);
	}

	[Fact]
	public async Task A_chained_effect_checkpoints_between_every_hop()
	{
		var (state, ctx) = Game();
		state.Track!.Positions.First(p => p.PlayerId == "A").Square = 18;

		await TrackTurnFlow.ProcessRollAsync(2, state.Players[0], ctx); // 20 → 25 → 10

		Assert.Equal(2, TestFixtures.Presenter(ctx).CheckpointCount);
		Assert.Equal(10, Pos(state, "A"));
	}

	[Fact]
	public async Task A_ladder_speaks_the_up_line_and_a_bounce_is_voiced()
	{
		var (state, ctx) = Game();
		await TrackTurnFlow.ProcessRollAsync(3, state.Players[0], ctx); // 3 → ladder → 12
		Assert.Contains(TestFixtures.Announcer(ctx).Sent, a => a.Key == "game.track_effect_up");
		Assert.Equal(12, Pos(state, "A"));

		state.CurrentTurn = "A";
		state.Track!.Positions.First(p => p.PlayerId == "A").Square = 28;
		await TrackTurnFlow.ProcessRollAsync(5, state.Players[0], ctx); // 33 → bounce → 27
		Assert.Contains(TestFixtures.Announcer(ctx).Sent, a => a.Key == "game.track_bounced");
		Assert.Equal(27, Pos(state, "A"));
	}

	[Fact]
	public async Task Winning_takes_place_1_and_a_two_player_game_ends_with_places()
	{
		var (state, ctx) = Game();
		state.Track!.Positions.First(p => p.PlayerId == "A").Square = 27;

		await TrackTurnFlow.ProcessRollAsync(3, state.Players[0], ctx); // exact 30

		Assert.Equal(1, state.Players[0].FinishPlace);
		Assert.Equal(2, state.Players[1].FinishPlace);
		Assert.True(state.IsGameOver);
		Assert.Equal("A", state.WinnerId);
		var sent = TestFixtures.Announcer(ctx).Sent;
		Assert.Contains(sent, a => a.Key == "game.track_won");
		Assert.Contains(sent, a => a.Key == "game.game_over");
	}
}
