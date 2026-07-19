using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The trivia turn flow on top of the pure rulebook: roll → choose a landing → a question of
/// that category → a judge (or the auto-matcher) rules → earn a wedge and roll again, or pass
/// the turn. The SERVER owns the voice, so every step is asserted through the FakeAnnouncer.
/// </summary>
public class TriviaTurnFlowTests
{
	private static TriviaBoardDef WedgeRing() => new()
	{
		SpokeLength = 2,
		Ring = Enumerable.Range(0, 6).Select(c => new TriviaRingSlot { Category = c, Wedge = true }).ToList(),
	};

	private static List<TriviaQuestionDef> Deck() => Enumerable.Range(0, 6)
		.Select(c => new TriviaQuestionDef
		{
			Id = $"q{c}",
			Category = c,
			Prompt = "?",
			Answer = "right",
			Accept = new() { "right" },
			Choices = new() { "right", "x", "y", "z" },
		}).ToList();

	private static (GameState State, GameContext Ctx) Game(TriviaBoardDef? board = null, string answerMode = "judge")
	{
		board ??= WedgeRing();
		var rules = new TriviaRulesConfig { AnswerMode = answerMode };
		var players = new[] { TestFixtures.NewPlayer("A"), TestFixtures.NewPlayer("B") };
		var state = TestFixtures.NewState(players);
		state.GameType = "trivia";
		state.Trivia = TriviaRulebook.CreateInitialState(new[] { "A", "B" });
		state.TriviaBoard = board;
		state.TriviaRules = rules;
		state.TriviaDeck = Deck();
		state.CurrentTurn = "A";
		var ctx = TestFixtures.NewContext(state, triviaBoard: board, triviaRules: rules);
		return (state, ctx);
	}

	private static TriviaPlayerState Seat(GameState st, string id) => st.Trivia!.Players.First(p => p.PlayerId == id);
	private static List<string> Keys(GameContext ctx) => TestFixtures.Announcer(ctx).Sent.Select(a => a.Key).ToList();

	[Fact]
	public async Task Roll_offers_the_landing_options_and_announces_the_roll()
	{
		var (state, ctx) = Game();
		await TriviaTurnFlow.ProcessRollAsync(3, state.Players[0], ctx); // centre → each spoke's wedge

		Assert.NotNull(state.Trivia!.PendingMove);
		Assert.Equal(6, state.Trivia.PendingMove!.Options.Count);
		Assert.Contains(TestFixtures.Announcer(ctx).Sent,
			a => a.Key == "game.trivia_rolled" && a.Phase == AnnouncementPhase.Move);
	}

	[Fact]
	public async Task Landing_on_a_wedge_poses_a_question_to_the_rotating_judge()
	{
		var (state, ctx) = Game();
		Seat(state, "A").Node = "R0"; // a wedge, category 0
		await TriviaTurnFlow.ResolveLandingAsync(state.Players[0], ctx);

		var q = state.Trivia!.PendingQuestion!;
		Assert.Equal("A", q.PlayerId);
		Assert.Equal("B", q.JudgeId); // rotating: the next player
		Assert.True(q.OnWedge);
		Assert.Equal(0, q.Category);
		Assert.Contains("game.trivia_moved_wedge", Keys(ctx));
		Assert.Contains("game.trivia_question", Keys(ctx));
	}

	[Fact]
	public async Task A_correct_verdict_on_a_wedge_earns_it_and_grants_another_roll()
	{
		var (state, ctx) = Game();
		Seat(state, "A").Node = "R0";
		await TriviaTurnFlow.ResolveLandingAsync(state.Players[0], ctx);

		await new TriviaAnswerHandler().HandleAsync(new TriviaAnswerCommand { PlayerId = "A", Text = "right" }, ctx);
		Assert.Equal("right", state.Trivia!.PendingQuestion!.Submitted); // stored, awaiting the judge

		var resp = await new TriviaJudgeHandler().HandleAsync(new TriviaJudgeCommand { PlayerId = "B", Correct = true }, ctx);

		Assert.True(Assert.IsType<TriviaActionResponse>(resp).RollAgain);
		Assert.Null(state.Trivia.PendingQuestion);
		Assert.Contains(0, Seat(state, "A").Wedges);
		Assert.Equal("A", state.CurrentTurn); // still their turn
		Assert.Contains("game.trivia_reveal", Keys(ctx));
		Assert.Contains("game.trivia_correct", Keys(ctx));
		Assert.Contains("game.trivia_wedge", Keys(ctx));
		Assert.Contains("game.trivia_again", Keys(ctx)); // a correct answer tells you to roll again
	}

	[Fact]
	public async Task A_wrong_verdict_reveals_the_answer_and_passes_the_turn()
	{
		var (state, ctx) = Game();
		Seat(state, "A").Node = "R0";
		await TriviaTurnFlow.ResolveLandingAsync(state.Players[0], ctx);
		await new TriviaAnswerHandler().HandleAsync(new TriviaAnswerCommand { PlayerId = "A", Text = "nope" }, ctx);

		var resp = await new TriviaJudgeHandler().HandleAsync(new TriviaJudgeCommand { PlayerId = "B", Correct = false }, ctx);

		Assert.True(Assert.IsType<TriviaActionResponse>(resp).TurnEnded);
		Assert.Equal("B", state.CurrentTurn);
		Assert.Empty(Seat(state, "A").Wedges);
		Assert.Contains("game.trivia_wrong", Keys(ctx));
	}

	[Fact]
	public async Task A_wrong_player_cannot_judge()
	{
		var (state, ctx) = Game();
		Seat(state, "A").Node = "R0";
		await TriviaTurnFlow.ResolveLandingAsync(state.Players[0], ctx);
		await new TriviaAnswerHandler().HandleAsync(new TriviaAnswerCommand { PlayerId = "A", Text = "right" }, ctx);

		// The active player is not the judge; the command is refused.
		var resp = await new TriviaJudgeHandler().HandleAsync(new TriviaJudgeCommand { PlayerId = "A", Correct = true }, ctx);
		Assert.Equal("TRIVIA_NOT_JUDGE", Assert.IsType<ErrorResponse>(resp).Code);
	}

	[Fact]
	public async Task Choice_mode_auto_adjudicates_without_a_judge()
	{
		var (state, ctx) = Game(answerMode: "choice");
		Seat(state, "A").Node = "R0";
		await TriviaTurnFlow.ResolveLandingAsync(state.Players[0], ctx);

		var q = state.Trivia!.PendingQuestion!;
		Assert.Equal("", q.JudgeId);           // no judge in choice mode
		Assert.NotEmpty(q.Choices);

		var resp = await new TriviaAnswerHandler().HandleAsync(
			new TriviaAnswerCommand { PlayerId = "A", Choice = q.CorrectChoice }, ctx);

		Assert.True(Assert.IsType<TriviaActionResponse>(resp).RollAgain);
		Assert.Contains(0, Seat(state, "A").Wedges);
	}

	[Fact]
	public async Task A_roll_again_square_grants_another_roll_with_no_question()
	{
		var board = new TriviaBoardDef
		{
			SpokeLength = 1,
			Ring = new()
			{
				new() { Category = 0, Wedge = true }, new() { Category = 1, RollAgain = true },
				new() { Category = 1, Wedge = true }, new() { Category = 2, Wedge = true },
				new() { Category = 3, Wedge = true }, new() { Category = 4, Wedge = true },
				new() { Category = 5, Wedge = true },
			},
		};
		var (state, ctx) = Game(board);
		Seat(state, "A").Node = "R1"; // the roll-again slot

		var resp = await TriviaTurnFlow.ResolveLandingAsync(state.Players[0], ctx);

		Assert.True(Assert.IsType<TriviaActionResponse>(resp).RollAgain);
		Assert.Null(state.Trivia!.PendingQuestion);
		Assert.Contains("game.trivia_roll_again", Keys(ctx));
	}

	[Fact]
	public async Task The_final_question_at_the_centre_wins_the_game()
	{
		var (state, ctx) = Game();
		var seat = Seat(state, "A");
		seat.Wedges.AddRange(new[] { 0, 1, 2, 3, 4, 5 }); // all wedges — ready for the final
		seat.Node = "C";

		await TriviaTurnFlow.ResolveLandingAsync(state.Players[0], ctx);
		Assert.True(state.Trivia!.PendingQuestion!.IsFinal);
		Assert.Contains("game.trivia_final", Keys(ctx));

		await new TriviaAnswerHandler().HandleAsync(new TriviaAnswerCommand { PlayerId = "A", Text = "right" }, ctx);
		var resp = await new TriviaJudgeHandler().HandleAsync(new TriviaJudgeCommand { PlayerId = "B", Correct = true }, ctx);

		Assert.True(Assert.IsType<TriviaActionResponse>(resp).GameEnded);
		Assert.True(state.IsGameOver);
		Assert.Equal("A", state.WinnerId);
		Assert.Contains("game.trivia_won", Keys(ctx));
	}
}
