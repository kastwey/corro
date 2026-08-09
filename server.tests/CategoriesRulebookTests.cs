using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

public class CategoriesRulebookTests
{
	private static readonly CategoriesRulesConfig Rules = new()
	{
		RoundSeconds = 60,
		CategoriesPerRound = 2,
		PointsPerAnswer = 1,
		Cycles = 1,
	};

	private static CategoryDeckDef Deck(int categories = 8) => new()
	{
		Letters = new List<string> { "A", "B", "C", "D", "E" },
		Categories = Enumerable.Range(0, categories)
			.Select(index => new CategoryDef { Id = $"c{index}", Name = $"Category {index}" })
			.ToList(),
	};

	private static CategoriesState NewGame(int players = 3)
		=> CategoriesRulebook.CreateInitialState(
			Enumerable.Range(0, players).Select(index => $"p{index}").ToList(),
			Deck(),
			Rules);

	private static void Write(CategoriesState state, string playerId, params string[] answers)
	{
		for (var index = 0; index < answers.Length; index++)
		{
			CategoriesRulebook.WriteAnswer(
				state.Round,
				playerId,
				state.Round.Prompts[index].CategoryId,
				answers[index]);
		}
	}

	[Fact]
	public void A_new_game_deals_a_letter_categories_and_one_blank_answer_per_writer()
	{
		var state = NewGame();

		Assert.Equal("p0", state.Round.JudgeId);
		Assert.Equal(1, state.Round.RoundNumber);
		Assert.Equal(CategoriesRoundPhase.Preparing, state.Round.Phase);
		Assert.Equal(Rules.CategoriesPerRound, state.Round.Prompts.Count);
		Assert.Equal("A", state.Round.Letter);
		// The judge does not write, so they have no answer to write in.
		Assert.All(state.Round.Prompts, prompt => Assert.Equal(
			new[] { "p1", "p2" },
			prompt.Answers.Select(answer => answer.PlayerId)));
		Assert.All(state.Round.Prompts, prompt => Assert.All(prompt.Answers,
			answer => Assert.Equal(string.Empty, answer.Text)));
	}

	[Fact]
	public void A_table_of_two_cannot_play_because_no_answer_could_ever_coincide()
		=> Assert.Throws<InvalidOperationException>(() => NewGame(players: 2));

	[Fact]
	public void Writing_stores_trimmed_text_and_rejects_a_category_outside_the_round()
	{
		var state = NewGame();

		var stored = CategoriesRulebook.WriteAnswer(state.Round, "p1", state.Round.Prompts[0].CategoryId, "  Apple  ");
		var unknown = CategoriesRulebook.WriteAnswer(state.Round, "p1", "not-in-this-round", "Apple");
		var judge = CategoriesRulebook.WriteAnswer(state.Round, "p0", state.Round.Prompts[0].CategoryId, "Apple");

		Assert.True(stored);
		Assert.False(unknown);
		Assert.False(judge);
		Assert.Equal("Apple", state.Round.Prompts[0].Answers.First(a => a.PlayerId == "p1").Text);
	}

	[Fact]
	public void Review_gathers_coincidences_flags_the_letter_and_rejects_blanks_without_a_human()
	{
		var state = NewGame();
		Write(state, "p1", "Ánsar", "banana");
		Write(state, "p2", "ansar", "");

		CategoriesRulebook.BeginReview(state.Round);

		var first = state.Round.Prompts[0].Answers;
		// "Ánsar" and "ansar" normalize alike, so they are offered as one coincidence…
		Assert.Equal(first[0].DuplicateGroup, first[1].DuplicateGroup);
		Assert.True(first[0].DuplicateGroup >= 0);
		// …but nothing has been RULED: the judge still decides whether they are the same answer.
		Assert.All(first, answer => Assert.Equal(CategoriesVerdict.Pending, answer.Verdict));
		Assert.All(first, answer => Assert.True(answer.MatchesLetter));

		var second = state.Round.Prompts[1].Answers;
		Assert.False(second.First(a => a.PlayerId == "p1").MatchesLetter);
		Assert.Equal(-1, second.First(a => a.PlayerId == "p1").DuplicateGroup);
		// Nobody needs a judge to rule on nothing.
		Assert.Equal(CategoriesVerdict.Rejected, second.First(a => a.PlayerId == "p2").Verdict);
	}

	[Fact]
	public void Suggested_rulings_agree_with_every_hint_but_are_only_a_starting_point()
	{
		var state = NewGame();
		Write(state, "p1", "Apple", "avocado");
		Write(state, "p2", "apple", "banana");
		CategoriesRulebook.BeginReview(state.Round);

		var first = CategoriesRulebook.SuggestedRulings(state.Round.Prompts[0]);
		var second = CategoriesRulebook.SuggestedRulings(state.Round.Prompts[1]);

		Assert.Equal(CategoriesVerdict.Duplicate, first["p1"]);
		Assert.Equal(CategoriesVerdict.Duplicate, first["p2"]);
		Assert.Equal(CategoriesVerdict.Accepted, second["p1"]);
		Assert.Equal(CategoriesVerdict.Rejected, second["p2"]);
	}

	[Fact]
	public void The_judge_may_overrule_a_suggested_duplicate_and_the_score_follows_the_ruling()
	{
		var state = NewGame();
		Write(state, "p1", "Apple", "apricot");
		Write(state, "p2", "apple", "almond");
		CategoriesRulebook.BeginReview(state.Round);

		// The judge decides the two spellings are NOT the same answer after all.
		CategoriesRulebook.RulePrompt(state.Round.Prompts[0], new Dictionary<string, CategoriesVerdict>
		{
			["p1"] = CategoriesVerdict.Accepted,
			["p2"] = CategoriesVerdict.Accepted,
		});
		CategoriesRulebook.RulePrompt(state.Round.Prompts[1], new Dictionary<string, CategoriesVerdict>
		{
			["p1"] = CategoriesVerdict.Accepted,
			["p2"] = CategoriesVerdict.Rejected,
		});
		var scores = CategoriesRulebook.ScoreRound(state, state.Round, Rules);

		Assert.Equal(2, scores.First(score => score.PlayerId == "p1").Points);
		Assert.Equal(1, scores.First(score => score.PlayerId == "p2").Points);
		Assert.Equal(2, state.Players.First(player => player.PlayerId == "p1").Score);
	}

	[Fact]
	public void A_blank_answer_stays_rejected_even_when_a_ruling_tries_to_accept_it()
	{
		var state = NewGame();
		Write(state, "p1", "", "");
		Write(state, "p2", "Apple", "Apricot");
		CategoriesRulebook.BeginReview(state.Round);

		CategoriesRulebook.RulePrompt(state.Round.Prompts[0], new Dictionary<string, CategoriesVerdict>
		{
			["p1"] = CategoriesVerdict.Accepted,
			["p2"] = CategoriesVerdict.Accepted,
		});

		Assert.Equal(
			CategoriesVerdict.Rejected,
			state.Round.Prompts[0].Answers.First(answer => answer.PlayerId == "p1").Verdict);
	}

	[Fact]
	public void The_judge_rotates_and_a_complete_round_deals_a_new_letter_and_new_categories()
	{
		var state = NewGame();
		var seats = new[] { "p0", "p1", "p2" };
		var firstLetter = state.Round.Letter;
		var firstCategories = state.Round.Prompts.Select(prompt => prompt.CategoryId).ToList();

		var advance = CategoriesRulebook.CompleteRound(state, seats, Deck(), new CategoriesRulesConfig
		{
			RoundSeconds = 60, CategoriesPerRound = 2, PointsPerAnswer = 1, Cycles = 2,
		});

		Assert.False(advance.GameOver);
		Assert.Equal("p1", state.Round.JudgeId);
		Assert.Equal(2, state.Round.RoundNumber);
		Assert.NotEqual(firstLetter, state.Round.Letter);
		Assert.Empty(firstCategories.Intersect(state.Round.Prompts.Select(prompt => prompt.CategoryId)));
	}

	[Fact]
	public void The_match_ends_when_every_player_has_judged_and_one_of_them_leads()
	{
		var state = NewGame();
		var seats = new[] { "p0", "p1", "p2" };
		state.Players.First(player => player.PlayerId == "p1").Score = 5;

		CategoriesRulebook.CompleteRound(state, seats, Deck(), Rules);
		CategoriesRulebook.CompleteRound(state, seats, Deck(), Rules);
		var last = CategoriesRulebook.CompleteRound(state, seats, Deck(), Rules);

		Assert.True(last.GameOver);
		Assert.Equal("p1", last.WinnerId);
	}

	[Fact]
	public void A_tie_at_the_end_of_a_rotation_adds_another_whole_rotation_instead_of_sharing_the_win()
	{
		var state = NewGame();
		var seats = new[] { "p0", "p1", "p2" };

		CategoriesRulebook.CompleteRound(state, seats, Deck(), Rules);
		CategoriesRulebook.CompleteRound(state, seats, Deck(), Rules);
		var last = CategoriesRulebook.CompleteRound(state, seats, Deck(), Rules);

		Assert.False(last.GameOver);
		Assert.True(last.TieBreakerStarted);
		Assert.Equal(2, state.Cycle);
		Assert.Equal("p0", state.Round.JudgeId);
	}

	[Fact]
	public void The_next_judge_skips_a_seat_that_is_no_longer_in_the_game()
	{
		var state = NewGame(players: 4);
		state.Players.RemoveAll(player => player.PlayerId == "p1");

		var next = CategoriesRulebook.NextJudge(state, new[] { "p0", "p2", "p3" }, "p0");

		Assert.Equal("p2", next);
	}

	[Fact]
	public void The_clock_expires_only_while_the_round_is_being_written()
	{
		var state = NewGame();
		var started = new DateTime(2026, 8, 9, 12, 0, 0, DateTimeKind.Utc);
		state.Round.StartedAt = started;

		Assert.False(CategoriesRulebook.IsExpired(state.Round, started.AddSeconds(120)));
		state.Round.Phase = CategoriesRoundPhase.Writing;
		Assert.False(CategoriesRulebook.IsExpired(state.Round, started.AddSeconds(59)));
		Assert.True(CategoriesRulebook.IsExpired(state.Round, started.AddSeconds(60)));
		Assert.True(CategoriesRulebook.IsExpired(state.Round, started.AddSeconds(90)));
	}
}
