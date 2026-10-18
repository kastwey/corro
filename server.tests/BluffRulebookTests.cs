using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

public class BluffRulebookTests
{
	private static readonly BluffRulesConfig Rules = new()
	{
		WriteSeconds = 45,
		VoteSeconds = 30,
		Rounds = 2,
		TruthPoints = 1000,
		FoolPoints = 500,
		BallotSize = 3,
		Finalists = 2,
	};

	private static readonly DateTime Now = new(2026, 10, 18, 12, 0, 0, DateTimeKind.Utc);

	private static List<BluffQuestionDef> Deck(int count = 4)
		=> Enumerable.Range(0, count)
			.Select(index => new BluffQuestionDef
			{
				Id = $"q{index}",
				Question = $"Question {index} ___.",
				Truth = $"Truth {index}",
				AlsoTrue = new List<string> { $"the truth {index}" },
			})
			.ToList();

	private static List<string> Players(int count)
		=> Enumerable.Range(0, count).Select(index => $"p{index}").ToList();

	/// <summary>A game with the writing already open, which is where nearly every rule starts.</summary>
	private static BluffState NewGame(int players = 3, BluffRulesConfig? rules = null)
	{
		var state = BluffRulebook.CreateInitialState(Players(players), "p0", Deck(), rules ?? Rules);
		BluffRulebook.StartWriting(state.Round, rules ?? Rules, Now);
		return state;
	}

	private static void WriteAll(BluffState state, params string[] lies)
	{
		for (var index = 0; index < lies.Length; index++)
		{
			Assert.Equal(BluffRulebook.WriteOutcome.Saved, BluffRulebook.Write(state.Round, $"p{index}", lies[index]));
		}
	}

	private static int OptionIndex(BluffBallotState ballot, string key)
		=> ballot.Options.First(option => option.Key == key).Index;

	[Fact]
	public void A_new_game_deals_the_first_question_with_one_blank_entry_per_player_and_the_host_in_charge()
	{
		var state = BluffRulebook.CreateInitialState(Players(4), "p2", Deck(), Rules);

		Assert.Equal("p2", state.MasterId);
		Assert.Equal(1, state.Round.RoundNumber);
		Assert.Equal(BluffPhase.Preparing, state.Round.Phase);
		Assert.Equal("q0", state.Round.QuestionId);
		Assert.Equal("Truth 0", state.Round.Truth);
		Assert.Equal(4, state.Round.Entries.Count);
		Assert.All(state.Round.Entries, entry => Assert.Equal(string.Empty, entry.Text));
		Assert.Equal(Rules.Rounds, state.RoundsToPlay);
		Assert.Null(BluffRulebook.IsTimed(state.Round) ? state.Round.StartedAt : null);
	}

	[Fact]
	public void A_table_of_two_cannot_play_because_one_bluff_and_one_truth_is_a_coin_toss()
		=> Assert.Throws<InvalidOperationException>(() => BluffRulebook.CreateInitialState(Players(2), "p0", Deck(), Rules));

	[Fact]
	public void The_master_must_be_at_the_table()
		=> Assert.Throws<InvalidOperationException>(() => BluffRulebook.CreateInitialState(Players(3), "ghost", Deck(), Rules));

	[Fact]
	public void Writing_trims_the_text_and_refuses_the_truth_in_any_spelling()
	{
		var state = NewGame();

		Assert.Equal(BluffRulebook.WriteOutcome.Saved, BluffRulebook.Write(state.Round, "p1", "  a tall tale  "));
		Assert.Equal("a tall tale", state.Round.Entries[1].Text);
		Assert.Equal(BluffRulebook.WriteOutcome.MatchesTruth, BluffRulebook.Write(state.Round, "p1", "TRUTH 0"));
		Assert.Equal(BluffRulebook.WriteOutcome.MatchesTruth, BluffRulebook.Write(state.Round, "p1", "Trúth, 0!"));
		Assert.Equal(BluffRulebook.WriteOutcome.MatchesTruth, BluffRulebook.Write(state.Round, "p1", "The Truth 0"));
		// A refused write leaves the earlier bluff standing.
		Assert.Equal("a tall tale", state.Round.Entries[1].Text);
	}

	[Fact]
	public void Writing_is_refused_when_too_long_after_finishing_or_outside_the_writing_phase()
	{
		var state = NewGame();

		Assert.Equal(BluffRulebook.WriteOutcome.TooLong,
			BluffRulebook.Write(state.Round, "p1", new string('x', BluffRulebook.MaxLieLength + 1)));
		Assert.True(BluffRulebook.FinishWriting(state.Round, "p1"));
		Assert.False(BluffRulebook.FinishWriting(state.Round, "p1"));
		Assert.Equal(BluffRulebook.WriteOutcome.AlreadyFinished, BluffRulebook.Write(state.Round, "p1", "late"));
		Assert.Equal(BluffRulebook.WriteOutcome.NotWriting, BluffRulebook.Write(state.Round, "ghost", "who"));
		Assert.Equal(2, BluffRulebook.WritersRemaining(state.Round));

		state.Round.Phase = BluffPhase.Voting;
		Assert.Equal(BluffRulebook.WriteOutcome.NotWriting, BluffRulebook.Write(state.Round, "p0", "late"));
	}

	[Fact]
	public void Closing_the_writing_merges_identical_bluffs_drops_blanks_and_keeps_every_author()
	{
		var state = NewGame(4);
		WriteAll(state, "The Moon", "the moon!", "", "Mars");

		BluffRulebook.CloseWriting(state.Round, Rules, null, Now);

		Assert.Equal(BluffPhase.Voting, state.Round.Phase);
		Assert.Equal(Rules.VoteSeconds, state.Round.DurationSeconds);
		Assert.Equal(Now, state.Round.StartedAt);
		Assert.Equal(2, state.Round.Lies.Count);
		var moon = Assert.Single(state.Round.Lies, lie => lie.Text == "The Moon");
		Assert.Equal(new[] { "p0", "p1" }, moon.AuthorIds);
		Assert.Equal(new[] { "p3" }, Assert.Single(state.Round.Lies, lie => lie.Text == "Mars").AuthorIds);
	}

	[Fact]
	public void A_small_table_gets_every_bluff_but_its_own_and_the_truth_on_each_ballot()
	{
		var state = NewGame(4);
		WriteAll(state, "A", "B", "C", "D");

		BluffRulebook.CloseWriting(state.Round, Rules, null, Now);

		Assert.Equal(4, state.Round.Ballots.Count);
		foreach (var ballot in state.Round.Ballots)
		{
			Assert.Equal(4, ballot.Options.Count);
			Assert.Single(ballot.Options, option => option.Key == BluffBallotState.TruthKey);
			Assert.DoesNotContain(ballot.Options, option => option.Text == ballot.PlayerId.Replace("p", "")
				|| state.Round.Lies.First(lie => lie.Id == option.Key || option.Key == BluffBallotState.TruthKey) is { } lie
					&& lie.AuthorIds.Contains(ballot.PlayerId) && option.Key != BluffBallotState.TruthKey);
			Assert.True(ballot.AsksFunny);
			Assert.Equal(Enumerable.Range(0, 4), ballot.Options.Select(option => option.Index));
		}
		Assert.All(state.Round.Lies, lie => Assert.Equal(3, lie.ShownCount));
	}

	[Fact]
	public void A_big_table_deals_each_bluff_onto_the_same_number_of_ballots_and_never_onto_its_authors()
	{
		var state = NewGame(12);
		WriteAll(state, Enumerable.Range(0, 12).Select(index => $"Lie {index}").ToArray());

		BluffRulebook.CloseWriting(state.Round, Rules, null, Now);

		Assert.Equal(12, state.Round.Ballots.Count);
		foreach (var ballot in state.Round.Ballots)
		{
			Assert.Equal(Rules.BallotSize + 1, ballot.Options.Count);
			var own = state.Round.Lies.First(lie => lie.AuthorIds.Contains(ballot.PlayerId));
			Assert.DoesNotContain(ballot.Options, option => option.Key == own.Id);
		}
		// Twelve ballots of three bluffs over twelve bluffs: three showings each on average. The
		// least-shown-first deal keeps every bluff within a showing or two of every other; the
		// slack is what "never your own" costs when your own bluff is the one shown least.
		Assert.Equal(36, state.Round.Lies.Sum(lie => lie.ShownCount));
		Assert.True(state.Round.Lies.Max(lie => lie.ShownCount) - state.Round.Lies.Min(lie => lie.ShownCount) <= 2);
		Assert.All(state.Round.Lies, lie => Assert.InRange(lie.ShownCount, 2, 4));
	}

	[Fact]
	public void A_ballot_takes_one_mark_at_a_time_refuses_the_same_line_twice_and_says_when_it_is_complete()
	{
		var state = NewGame(4);
		WriteAll(state, "A", "B", "C", "D");
		BluffRulebook.CloseWriting(state.Round, Rules, null, Now);
		var ballot = BluffRulebook.BallotOf(state.Round, "p0", final: false)!;

		Assert.Equal(BluffRulebook.VoteOutcome.UnknownOption, BluffRulebook.Vote(state.Round, "p0", false, 9, null).Outcome);
		Assert.Equal(BluffRulebook.VoteOutcome.NoBallot, BluffRulebook.Vote(state.Round, "ghost", false, 0, null).Outcome);
		Assert.Equal(BluffRulebook.VoteOutcome.WrongPhase, BluffRulebook.Vote(state.Round, "p0", true, 0, null).Outcome);

		var first = BluffRulebook.Vote(state.Round, "p0", false, 1, null);
		Assert.Equal(BluffRulebook.VoteOutcome.Marked, first.Outcome);
		Assert.False(first.BallotCompleted);
		Assert.Equal(BluffRulebook.VoteOutcome.SameOption, BluffRulebook.Vote(state.Round, "p0", false, null, 1).Outcome);

		var second = BluffRulebook.Vote(state.Round, "p0", false, null, 2);
		Assert.True(second.BallotCompleted);
		Assert.True(BluffRulebook.IsComplete(ballot));
		Assert.Equal(3, BluffRulebook.VotersRemaining(state.Round, final: false));

		// Moving the truth onto the line called funniest drops the funny mark rather than refusing.
		var moved = BluffRulebook.Vote(state.Round, "p0", false, 2, null);
		Assert.Equal(BluffRulebook.VoteOutcome.Marked, moved.Outcome);
		Assert.Equal(2, ballot.TruthPick);
		Assert.Null(ballot.FunnyPick);
		Assert.False(moved.BallotCompleted);
	}

	[Fact]
	public void A_ballot_with_one_bluff_does_not_ask_for_the_funniest()
	{
		var state = NewGame(3);
		WriteAll(state, "A", "", "");
		BluffRulebook.CloseWriting(state.Round, Rules, null, Now);

		var ballot = BluffRulebook.BallotOf(state.Round, "p1", final: false)!;
		Assert.False(ballot.AsksFunny);
		Assert.Equal(BluffRulebook.VoteOutcome.NotAsked, BluffRulebook.Vote(state.Round, "p1", false, null, 0).Outcome);
		Assert.True(BluffRulebook.Vote(state.Round, "p1", false, 0, null).BallotCompleted);
		// The author's ballot carries only the truth and is complete with that one mark.
		var own = BluffRulebook.BallotOf(state.Round, "p0", final: false)!;
		Assert.Single(own.Options);
	}

	[Fact]
	public void A_small_table_goes_straight_to_the_reveal_and_the_votes_say_the_points()
	{
		var state = NewGame(4);
		WriteAll(state, "A", "B", "C", "D");
		BluffRulebook.CloseWriting(state.Round, Rules, null, Now);
		var lieA = state.Round.Lies.First(lie => lie.Text == "A");
		// p1 and p2 fall for A and call B funny; p3 finds the truth and calls A funny; p0 finds it too.
		foreach (var voter in new[] { "p1", "p2" })
		{
			var ballot = BluffRulebook.BallotOf(state.Round, voter, false)!;
			BluffRulebook.Vote(state.Round, voter, false, OptionIndex(ballot, lieA.Id), null);
			var funny = ballot.Options.First(option => option.Key != lieA.Id && option.Key != BluffBallotState.TruthKey).Index;
			BluffRulebook.Vote(state.Round, voter, false, null, funny);
		}
		foreach (var finder in new[] { "p0", "p3" })
		{
			var ballot = BluffRulebook.BallotOf(state.Round, finder, false)!;
			BluffRulebook.Vote(state.Round, finder, false, OptionIndex(ballot, BluffBallotState.TruthKey), null);
			BluffRulebook.Vote(state.Round, finder, false, null, ballot.Options.First(option => option.Key != BluffBallotState.TruthKey).Index);
		}

		Assert.False(BluffRulebook.CloseVoting(state.Round, Rules, null, Now));
		Assert.Equal(BluffPhase.Reveal, state.Round.Phase);
		Assert.False(state.Round.HasFinal);
		Assert.Equal(new[] { "p0", "p3" }, state.Round.TruthFinderIds);
		Assert.Equal(new[] { "p1", "p2" }, lieA.BelieverIds);

		var reveal = BluffRulebook.Score(state, state.Round, Rules);

		Assert.Equal(2, reveal.TruthFinderCount);
		Assert.Equal(lieA.Id, reveal.BestLieId);
		var author = reveal.Results.First(result => result.PlayerId == "p0");
		Assert.True(author.FoundTruth);
		Assert.Equal(1000, author.TruthPoints);
		Assert.Equal(2, author.FooledCount);
		Assert.Equal(1000, author.FoolPoints);
		Assert.Equal(3, author.ShownCount);
		Assert.Equal(2000, author.Total);
		Assert.Equal(2000, state.Players.First(player => player.PlayerId == "p0").Score);
		Assert.Equal(0, reveal.Results.First(result => result.PlayerId == "p1").Total);
		Assert.Equal(1000, reveal.Results.First(result => result.PlayerId == "p3").Total);
	}

	[Fact]
	public void A_shared_bluff_divides_its_points_between_its_authors()
	{
		var state = NewGame(4);
		WriteAll(state, "Same", "same", "C", "D");
		BluffRulebook.CloseWriting(state.Round, Rules, null, Now);
		var shared = state.Round.Lies.First(lie => lie.AuthorIds.Count == 2);
		foreach (var voter in new[] { "p2", "p3" })
		{
			var ballot = BluffRulebook.BallotOf(state.Round, voter, false)!;
			BluffRulebook.Vote(state.Round, voter, false, OptionIndex(ballot, shared.Id), null);
		}
		BluffRulebook.CloseVoting(state.Round, Rules, null, Now);

		var reveal = BluffRulebook.Score(state, state.Round, Rules);

		// Two votes at 500 make 1000, split between the two who wrote it.
		Assert.Equal(500, reveal.Results.First(result => result.PlayerId == "p0").FoolPoints);
		Assert.Equal(500, reveal.Results.First(result => result.PlayerId == "p1").FoolPoints);
		Assert.Equal(2, reveal.Results.First(result => result.PlayerId == "p0").FooledCount);
	}

	[Fact]
	public void A_big_table_narrows_to_a_final_where_the_truth_finders_vote_among_bluffs_alone()
	{
		// Three bluffs per ballot: a final opens from seven distinct bluffs up.
		var state = NewGame(8);
		WriteAll(state, Enumerable.Range(0, 8).Select(index => $"Lie {index}").ToArray());
		BluffRulebook.CloseWriting(state.Round, Rules, null, Now);
		var lie0 = state.Round.Lies.First(lie => lie.Text == "Lie 0");
		var lie1 = state.Round.Lies.First(lie => lie.Text == "Lie 1");
		// Everybody who sees Lie 0 believes it; p7 finds the truth; the rest call Lie 1 funny when they can.
		foreach (var ballot in state.Round.Ballots)
		{
			var shows0 = ballot.Options.FirstOrDefault(option => option.Key == lie0.Id);
			if (ballot.PlayerId == "p7")
			{
				BluffRulebook.Vote(state.Round, "p7", false, OptionIndex(ballot, BluffBallotState.TruthKey), null);
			}
			else if (shows0 is not null)
			{
				BluffRulebook.Vote(state.Round, ballot.PlayerId, false, shows0.Index, null);
			}
			var shows1 = ballot.Options.FirstOrDefault(option => option.Key == lie1.Id && option.Index != ballot.TruthPick);
			if (shows1 is not null)
			{
				BluffRulebook.Vote(state.Round, ballot.PlayerId, false, null, shows1.Index);
			}
		}

		Assert.True(BluffRulebook.NeedsFinal(state.Round, Rules));
		Assert.True(BluffRulebook.CloseVoting(state.Round, Rules, null, Now));
		Assert.Equal(BluffPhase.FinalVoting, state.Round.Phase);
		Assert.True(state.Round.HasFinal);
		Assert.Equal(Rules.Finalists, state.Round.Lies.Count(lie => lie.Finalist));
		Assert.True(lie0.Finalist);
		Assert.True(lie1.Finalist);

		var finder = BluffRulebook.BallotOf(state.Round, "p7", final: true)!;
		Assert.True(finder.TruthKnown);
		Assert.False(finder.AsksFunny);
		Assert.DoesNotContain(finder.Options, option => option.Key == BluffBallotState.TruthKey);
		var other = BluffRulebook.BallotOf(state.Round, "p2", final: true)!;
		Assert.False(other.TruthKnown);
		Assert.Single(other.Options, option => option.Key == BluffBallotState.TruthKey);
		// Nobody is handed their own bluff, in the final either.
		var author0 = BluffRulebook.BallotOf(state.Round, "p0", final: true)!;
		Assert.DoesNotContain(author0.Options, option => option.Key == lie0.Id);

		// The final: p7 says Lie 0 would have fooled them; p2 finds the truth now; p3 falls for Lie 0.
		BluffRulebook.Vote(state.Round, "p7", true, OptionIndex(finder, lie0.Id), null);
		BluffRulebook.Vote(state.Round, "p2", true, OptionIndex(other, BluffBallotState.TruthKey), null);
		var p3 = BluffRulebook.BallotOf(state.Round, "p3", final: true)!;
		BluffRulebook.Vote(state.Round, "p3", true, OptionIndex(p3, lie0.Id), null);
		BluffRulebook.CloseFinal(state.Round);
		Assert.Equal(BluffPhase.Reveal, state.Round.Phase);
		Assert.Equal(new[] { "p2" }, state.Round.FinalTruthFinderIds);
		Assert.Equal(new[] { "p3", "p7" }, lie0.FinalBelieverIds);

		var reveal = BluffRulebook.Score(state, state.Round, Rules);

		// With a final the first vote pays half and the final pays full.
		var p0 = reveal.Results.First(result => result.PlayerId == "p0");
		Assert.Equal(lie0.BelieverIds.Count * 250 + 2 * 500, p0.FoolPoints);
		Assert.Equal(lie0.BelieverIds.Count + 2, p0.FooledCount);
		Assert.Equal(1000, reveal.Results.First(result => result.PlayerId == "p7").TruthPoints);
		Assert.Equal(500, reveal.Results.First(result => result.PlayerId == "p2").TruthPoints);
		Assert.Equal(2, reveal.TruthFinderCount);
		Assert.Equal(lie0.Id, reveal.BestLieId);
		Assert.Equal(lie1.Id, reveal.FunniestLieId);
	}

	[Fact]
	public void The_match_ends_after_the_agreed_rounds_with_a_lone_leader_and_a_tie_adds_one_round()
	{
		var state = NewGame(3);
		var deck = Deck();
		state.Players[0].Score = 1000;
		state.Round.Phase = BluffPhase.Reveal;

		var first = BluffRulebook.CompleteRound(state, deck);
		Assert.False(first.GameOver);
		Assert.Equal(2, state.Round.RoundNumber);
		Assert.Equal("q1", state.Round.QuestionId);
		Assert.Equal(BluffPhase.Preparing, state.Round.Phase);

		state.Players[1].Score = 1000;
		state.Round.Phase = BluffPhase.Reveal;
		var tied = BluffRulebook.CompleteRound(state, deck);
		Assert.False(tied.GameOver);
		Assert.True(tied.TieBreakerStarted);
		Assert.Equal(3, state.RoundsToPlay);
		Assert.Equal(3, state.Round.RoundNumber);

		state.Players[1].Score = 1500;
		state.Round.Phase = BluffPhase.Reveal;
		var decided = BluffRulebook.CompleteRound(state, deck);
		Assert.True(decided.GameOver);
		Assert.Equal("p1", decided.WinnerId);
	}

	[Fact]
	public void The_deck_wraps_when_the_rounds_outnumber_the_questions()
	{
		var state = BluffRulebook.CreateInitialState(Players(3), "p0", Deck(2), Rules with { Rounds = 5 });
		state.Round.Phase = BluffPhase.Reveal;
		BluffRulebook.CompleteRound(state, Deck(2));
		state.Round.Phase = BluffPhase.Reveal;
		BluffRulebook.CompleteRound(state, Deck(2));

		Assert.Equal("q0", state.Round.QuestionId);
		Assert.Equal(3, state.QuestionCursor);
	}

	[Fact]
	public void The_next_master_is_the_next_seat_still_at_the_table()
	{
		var state = NewGame(4);
		state.Players.RemoveAll(player => player.PlayerId == "p1");

		Assert.Equal("p2", BluffRulebook.NextMaster(state, new[] { "p0", "p1", "p2", "p3" }, "p0"));
		Assert.Equal("p0", BluffRulebook.NextMaster(state, new[] { "p0", "p1", "p2", "p3" }, "p3"));
	}

	[Fact]
	public void The_clock_expires_only_while_a_phase_is_timed()
	{
		var state = BluffRulebook.CreateInitialState(Players(3), "p0", Deck(), Rules);
		Assert.False(BluffRulebook.IsExpired(state.Round, Now.AddHours(1)));

		BluffRulebook.StartWriting(state.Round, Rules, Now);
		Assert.False(BluffRulebook.IsExpired(state.Round, Now.AddSeconds(44)));
		Assert.True(BluffRulebook.IsExpired(state.Round, Now.AddSeconds(45)));

		BluffRulebook.CloseWriting(state.Round, Rules, null, Now.AddSeconds(45));
		Assert.False(BluffRulebook.IsExpired(state.Round, Now.AddSeconds(74)));
		Assert.True(BluffRulebook.IsExpired(state.Round, Now.AddSeconds(75)));

		state.Round.Phase = BluffPhase.Reveal;
		Assert.False(BluffRulebook.IsExpired(state.Round, Now.AddHours(1)));
	}

	[Fact]
	public void Standings_rank_by_score_and_keep_seat_order_between_equals()
	{
		var state = NewGame(3);
		state.Players[2].Score = 500;

		Assert.Equal(new[] { "p2", "p0", "p1" }, BluffRulebook.Standings(state).Select(player => player.PlayerId));
	}
}
