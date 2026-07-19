using System.Collections.Generic;
using System.Linq;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

public class TriviaRulebookTests
{
	/// <summary>A minimal wheel: six ring slots, each a wedge of a distinct category.</summary>
	private static TriviaBoardDef Board(int spokeLength = 2) => new()
	{
		SpokeLength = spokeLength,
		Ring = Enumerable.Range(0, 6).Select(c => new TriviaRingSlot { Category = c, Wedge = true }).ToList(),
	};

	[Fact]
	public void Adjacency_center_links_all_six_spokes()
	{
		var adj = TriviaRulebook.BuildAdjacency(Board());
		Assert.Equal(6, adj["C"].Count);
		for (var i = 0; i < 6; i++)
		{
			Assert.Contains($"S{i}.1", adj["C"]);
		}
	}

	[Fact]
	public void Adjacency_wedge_junction_has_three_neighbours()
	{
		var adj = TriviaRulebook.BuildAdjacency(Board());
		// R0 is spoke 0's wedge: two ring neighbours (R5, R1) plus the spoke inward (S0.2).
		Assert.Equal(3, adj["R0"].Count);
		Assert.Contains("S0.2", adj["R0"]);
		Assert.Contains("R1", adj["R0"]);
		Assert.Contains("R5", adj["R0"]);
	}

	[Fact]
	public void Adjacency_spoke_interior_has_two_neighbours()
	{
		var adj = TriviaRulebook.BuildAdjacency(Board());
		Assert.Equal(new[] { "C", "S0.2" }, adj["S0.1"].OrderBy(x => x).ToArray());
	}

	[Fact]
	public void LegalLandings_from_center_roll_one_reaches_each_spoke_start()
	{
		var opts = TriviaRulebook.LegalLandings(Board(), "C", 1);
		Assert.Equal(6, opts.Count);
		for (var i = 0; i < 6; i++)
		{
			Assert.Contains($"S{i}.1", opts);
		}
	}

	[Fact]
	public void LegalLandings_never_backtracks_over_the_same_edge()
	{
		// Roll 1 from S0.1: only its two neighbours, never a stay.
		Assert.Equal(new[] { "C", "S0.2" }, TriviaRulebook.LegalLandings(Board(), "S0.1", 1));

		// Roll 2 from S0.1: out to the wedge (S0.2 -> R0) or through the centre to another
		// spoke — but never back onto S0.1.
		var two = TriviaRulebook.LegalLandings(Board(), "S0.1", 2);
		Assert.DoesNotContain("S0.1", two);
		Assert.Contains("R0", two);
		Assert.Contains("S1.1", two);
	}

	[Fact]
	public void CategoryOfNode_centre_is_wild_spokes_are_multicoloured_ring_reads_slot()
	{
		var board = Board();
		Assert.Equal(-1, TriviaRulebook.CategoryOfNode(board, "C"));
		Assert.Equal(1, TriviaRulebook.CategoryOfNode(board, "S0.1")); // spoke square: (0 + 1) % 6
		Assert.Equal(3, TriviaRulebook.CategoryOfNode(board, "R3"));   // slot category
	}

	[Fact]
	public void Wedge_helpers_read_the_ring_slot()
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
		Assert.True(TriviaRulebook.IsWedge(board, "R2"));
		Assert.Equal(1, TriviaRulebook.WedgeCategory(board, "R2"));
		Assert.True(TriviaRulebook.IsRollAgain(board, "R1"));
		Assert.False(TriviaRulebook.IsWedge(board, "R1"));
	}

	[Fact]
	public void Wedges_completion_and_first_missing()
	{
		var player = new TriviaPlayerState { PlayerId = "p" };
		Assert.False(TriviaRulebook.HasAllWedges(player));
		Assert.Equal(0, TriviaRulebook.FirstMissingWedge(player));

		player.Wedges.AddRange(new[] { 0, 1, 2, 4, 5 });
		Assert.Equal(3, TriviaRulebook.FirstMissingWedge(player));

		player.Wedges.Add(3);
		Assert.True(TriviaRulebook.HasAllWedges(player));
		Assert.Equal(-1, TriviaRulebook.FirstMissingWedge(player));
	}

	[Fact]
	public void JudgeFor_rotates_prefers_the_fixed_judge_and_skips_the_active_and_retired()
	{
		var order = new[] { "a", "b", "c" };
		var state = TriviaRulebook.CreateInitialState(order);

		Assert.Equal("b", TriviaRulebook.JudgeFor(order, state, "a", null));      // rotating: the next
		Assert.Equal("c", TriviaRulebook.JudgeFor(order, state, "a", "c"));       // fixed: the chosen
		Assert.Equal("b", TriviaRulebook.JudgeFor(order, state, "a", "a"));       // fixed is active -> rotate

		state.Players.First(p => p.PlayerId == "b").Retired = true;
		Assert.Equal("c", TriviaRulebook.JudgeFor(order, state, "a", null));      // skip retired

		state.Players.First(p => p.PlayerId == "c").Retired = true;
		Assert.Null(TriviaRulebook.JudgeFor(order, state, "a", null));            // nobody left
	}

	[Fact]
	public void PickQuestion_serves_a_category_in_order_and_wraps()
	{
		var deck = new List<TriviaQuestionDef>
		{
			new() { Id = "a1", Category = 0 }, new() { Id = "a2", Category = 0 }, new() { Id = "b1", Category = 1 },
		};
		var cursors = Enumerable.Repeat(0, 6).ToList();

		Assert.Equal("a1", TriviaRulebook.PickQuestion(deck, cursors, 0)!.Id);
		Assert.Equal("a2", TriviaRulebook.PickQuestion(deck, cursors, 0)!.Id);
		Assert.Equal("a1", TriviaRulebook.PickQuestion(deck, cursors, 0)!.Id); // wrapped
		Assert.Equal("b1", TriviaRulebook.PickQuestion(deck, cursors, 1)!.Id);
		Assert.Null(TriviaRulebook.PickQuestion(deck, cursors, 5));            // no such category
	}

	[Fact]
	public void AnswerMatches_normalises_case_accents_and_leading_articles()
	{
		var q = new TriviaQuestionDef { Answer = "París", Accept = new() { "paris" } };
		Assert.True(TriviaRulebook.AnswerMatches(q, "parís"));
		Assert.True(TriviaRulebook.AnswerMatches(q, "PARIS"));
		Assert.True(TriviaRulebook.AnswerMatches(q, "  la paris "));
		Assert.False(TriviaRulebook.AnswerMatches(q, "Londres"));
		Assert.False(TriviaRulebook.AnswerMatches(q, ""));

		var q2 = new TriviaQuestionDef { Answer = "Leonardo da Vinci", Accept = new() { "da vinci" } };
		Assert.True(TriviaRulebook.AnswerMatches(q2, "Da Vinci"));
	}

	[Fact]
	public void CreateInitialState_puts_everyone_at_the_centre_with_no_wedges()
	{
		var state = TriviaRulebook.CreateInitialState(new[] { "a", "b" });
		Assert.Equal(2, state.Players.Count);
		Assert.All(state.Players, p => Assert.Equal("C", p.Node));
		Assert.All(state.Players, p => Assert.Empty(p.Wedges));
		Assert.Equal(6, state.CategoryCursors.Count);
	}
}
