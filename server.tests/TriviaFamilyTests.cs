using System;
using System.Collections.Generic;
using System.Linq;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Bots;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The trivia family: validation of a wheel + question deck, the start-time judge gate, the
/// first BOARD family that hides information (a pending question's answer reaches only the
/// judge), no bots, and restore reading the rules off the snapshot.
/// </summary>
public class TriviaFamilyTests
{
	private static TriviaBoardDef Board() => new()
	{
		SpokeLength = 2,
		Ring = Enumerable.Range(0, 6).Select(c => new TriviaRingSlot { Category = c, Wedge = true }).ToList(),
	};

	private static List<TriviaQuestionDef> Deck() =>
		Enumerable.Range(0, 6)
			.Select(c => new TriviaQuestionDef { Id = $"q{c}", Category = c, Prompt = "?", Answer = "a" })
			.ToList();

	private static GameDefinition Definition(TriviaRulesConfig? rules = null) => new()
	{
		Manifest = new Manifest
		{
			GameType = "trivia",
			Locales = new List<string> { "es" },
			TriviaRules = rules ?? new TriviaRulesConfig(),
		},
		TriviaBoard = Board(),
		TriviaQuestions = new Dictionary<string, List<TriviaQuestionDef>> { ["es"] = Deck() },
	};

	private static FamilyStartContext Start(GameDefinition def, params string[] ids) => new()
	{
		Players = ids.Select(id => TestFixtures.NewPlayer(id)).ToList(),
		Definition = def,
		Lang = "es",
		Random = new ScriptedRandomSource(),
	};

	[Fact]
	public void Validate_accepts_a_well_formed_wheel() => new TriviaFamily().ValidateDefinition(Definition());

	[Fact]
	public void Validate_rejects_a_ring_without_six_distinct_wedges()
	{
		var def = Definition() with
		{
			TriviaBoard = new TriviaBoardDef { SpokeLength = 2, Ring = new() { new() { Category = 0, Wedge = true } } },
		};
		Assert.Throws<InvalidOperationException>(() => new TriviaFamily().ValidateDefinition(def));
	}

	[Fact]
	public void Validate_rejects_an_unknown_answer_mode()
	{
		var def = Definition(new TriviaRulesConfig { AnswerMode = "telepathy" });
		Assert.Throws<InvalidOperationException>(() => new TriviaFamily().ValidateDefinition(def));
	}

	[Fact]
	public void Validate_rejects_a_locale_missing_a_category()
	{
		var def = Definition() with
		{
			TriviaQuestions = new Dictionary<string, List<TriviaQuestionDef>> { ["es"] = Deck().Where(q => q.Category != 3).ToList() },
		};
		Assert.Throws<InvalidOperationException>(() => new TriviaFamily().ValidateDefinition(def));
	}

	[Fact]
	public void CreateGame_rotating_starts_the_first_player_with_no_judge_gate()
	{
		var game = new TriviaFamily().CreateGame(Start(Definition(), "a", "b"));
		Assert.Equal("a", game.State.CurrentTurn);
		Assert.Null(game.State.Trivia!.PendingJudgeSetup);
		Assert.Equal(6, game.State.TriviaDeck!.Count);
		Assert.All(game.State.Trivia.Players, p => Assert.Equal("C", p.Node));
	}

	[Fact]
	public void CreateGame_fixed_judge_gates_the_first_turn_on_the_host()
	{
		var def = Definition(new TriviaRulesConfig { AnswerMode = "judge", JudgeMode = "fixed" });
		var game = new TriviaFamily().CreateGame(Start(def, "host", "b"));
		Assert.Null(game.State.CurrentTurn); // nobody acts until the host picks the judge
		Assert.Equal("host", game.State.Trivia!.PendingJudgeSetup!.HostId);
	}

	[Fact]
	public void ProjectFor_reveals_the_answer_only_to_the_judge_and_never_mutates()
	{
		var family = new TriviaFamily();
		Assert.True(family.HasHiddenInformation);

		var state = new GameState
		{
			GameType = "trivia",
			TriviaDeck = Deck(),
			Trivia = new TriviaState
			{
				Players = new() { new() { PlayerId = "a" }, new() { PlayerId = "b" } },
				PendingQuestion = new TriviaPendingQuestion
				{
					PlayerId = "a",
					JudgeId = "b",
					QuestionId = "q0",
					Prompt = "?",
					CorrectAnswer = "SECRET",
					CorrectChoice = 2,
				},
			},
		};

		Assert.Equal("SECRET", family.ProjectFor(state, "b").Trivia!.PendingQuestion!.CorrectAnswer);
		Assert.Null(family.ProjectFor(state, "a").Trivia!.PendingQuestion!.CorrectAnswer);
		Assert.Null(family.ProjectFor(state, null).Trivia!.PendingQuestion!.CorrectAnswer);
		Assert.Equal(-1, family.ProjectFor(state, "a").Trivia!.PendingQuestion!.CorrectChoice);

		// The answer-bearing deck never reaches any client.
		Assert.Null(family.ProjectFor(state, "b").TriviaDeck);

		// Projection is a wire concern: the authoritative state is untouched.
		Assert.Equal("SECRET", state.Trivia!.PendingQuestion!.CorrectAnswer);
		Assert.NotNull(state.TriviaDeck);
	}

	[Fact]
	public void Trivia_ships_no_bot_policy() => Assert.False(BotPolicies.Supports("trivia"));

	[Fact]
	public void Runtime_reads_the_rules_off_the_state_on_restore()
	{
		var family = new TriviaFamily();
		Assert.True(family.SnapshotCarriesRules);
		var state = new GameState
		{
			GameType = "trivia",
			TriviaBoard = Board(),
			TriviaRules = new TriviaRulesConfig { AnswerMode = "choice" },
		};
		var runtime = (TriviaRuntime)family.RuntimeFromState(state)!;
		Assert.Equal("choice", runtime.Rules.AnswerMode);
	}
}
