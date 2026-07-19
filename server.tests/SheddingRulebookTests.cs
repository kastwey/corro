using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Pure rules of the shedding family: the round deal with its flip-to-a-
/// number opener, matching by colour / number value / action type, the wilds (honest
/// wild-draw gate), the action effects, the draw-and-maybe-play pause, the direction-
/// aware turn walk over retired seats, round scoring and the retirement fold.
/// </summary>
public class SheddingRulebookTests
{
	private static List<SheddingCardDef> Deck() => new()
	{
		new() { Id = "red-5", Type = "number", Color = "red", Value = 5, Count = 2, NameKey = "c.red5" },
		new() { Id = "red-7", Type = "number", Color = "red", Value = 7, Count = 2, NameKey = "c.red7" },
		new() { Id = "blue-5", Type = "number", Color = "blue", Value = 5, Count = 2, NameKey = "c.blue5" },
		new() { Id = "blue-7", Type = "number", Color = "blue", Value = 7, Count = 2, NameKey = "c.blue7" },
		new() { Id = "skip-red", Type = "skip", Color = "red", Count = 2, NameKey = "c.skipred" },
		new() { Id = "skip-blue", Type = "skip", Color = "blue", Count = 2, NameKey = "c.skipblue" },
		new() { Id = "rev-red", Type = "reverse", Color = "red", Count = 2, NameKey = "c.revred" },
		new() { Id = "d2-blue", Type = "drawTwo", Color = "blue", Count = 2, NameKey = "c.d2blue" },
		new() { Id = "wild", Type = "wild", Count = 2, NameKey = "c.wild" },
		new() { Id = "wild4", Type = "wildDrawFour", Count = 2, NameKey = "c.wild4" },
	};

	private static readonly Dictionary<string, SheddingCardDef> Catalog = SheddingRulebook.Catalog(Deck());
	private static readonly SheddingRulesConfig Rules = new();

	private static SheddingCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}@{n}", CardId = cardId };

	private static SheddingSeatState Seat(string id, params string[] hand)
		=> new() { PlayerId = id, Hand = hand.Select((c, i) => Inst(c, i)).ToList() };

	/// <summary>A mid-round state: the given top card in force, seats as built.</summary>
	private static SheddingState State(string topCardId, string? color = null, params SheddingSeatState[] seats)
	{
		var state = new SheddingState { Seats = seats.ToList() };
		state.DiscardPile.Add(Inst(topCardId, 9));
		state.CurrentColor = color ?? Catalog[topCardId].Color ?? "red";
		SheddingRulebook.SyncCounts(state);
		return state;
	}

	// ── The round deal ────────────────────────────────────────────────────────

	[Fact]
	public void DealRound_flips_past_actions_to_a_number_and_sets_the_colour()
	{
		// Identity shuffle: the pile keeps cards.json order and deals from its TAIL.
		// Hands of 2 for 2 players eat the four wilds; the flip then walks the actions
		// (they slide UNDER the pile) until blue-7 shows.
		var state = new SheddingState
		{
			Seats = { new SheddingSeatState { PlayerId = "a" }, new SheddingSeatState { PlayerId = "b" } },
		};
		var opener = SheddingRulebook.DealRound(
			state, Deck(), new SheddingRulesConfig { HandSize = 2 }, new ScriptedRandomSource());

		Assert.Equal("blue-7", opener.Id);
		Assert.Equal("blue", state.CurrentColor);
		Assert.Equal(1, state.Direction);
		Assert.All(state.Seats, s => Assert.Equal(2, s.Hand.Count));
		Assert.Single(state.DiscardPile);
		// The eight slid actions sit at the pile's BOTTOM, still in the game (each new
		// slide goes under the previous, so the LAST slid card holds position 0).
		Assert.Equal("skip-red#0", state.DrawPile[0].InstanceId);
		Assert.Equal(8 + 7, state.DrawPile.Count); // 8 slid actions + the 7 undealt numbers
	}

	// ── Matching ──────────────────────────────────────────────────────────────

	[Theory]
	[InlineData("red-7", true)]   // colour in force
	[InlineData("blue-5", true)]  // same number value, other colour
	[InlineData("blue-7", false)] // neither colour nor value
	[InlineData("skip-red", true)]  // colour in force
	[InlineData("skip-blue", false)] // action on a NUMBER top: nothing matches
	public void Matching_follows_colour_value_and_type(string cardId, bool expected)
	{
		var seat = Seat("a", cardId);
		var state = State("red-5", seats: new[] { seat, Seat("b") });
		Assert.Equal(expected, SheddingRulebook.CanPlay(Catalog[cardId], seat, state, Rules, Catalog).Ok);
	}

	[Fact]
	public void An_action_matches_the_same_action_type_across_colours()
	{
		var seat = Seat("a", "skip-blue");
		var state = State("skip-red", seats: new[] { seat, Seat("b") });
		Assert.True(SheddingRulebook.CanPlay(Catalog["skip-blue"], seat, state, Rules, Catalog).Ok);
	}

	[Fact]
	public void The_wild_draw_is_honest_no_card_of_the_colour_in_force_or_it_refuses()
	{
		var holding = Seat("a", "wild4", "red-7"); // holds the colour in force
		var state = State("red-5", seats: new[] { holding, Seat("b") });
		Assert.Equal("game.shedding_wild_needs_no_match",
			SheddingRulebook.CanPlay(Catalog["wild4"], holding, state, Rules, Catalog).ReasonKey);

		var clean = Seat("c", "wild4", "blue-7");
		Assert.True(SheddingRulebook.CanPlay(Catalog["wild4"], clean, state, Rules, Catalog).Ok);

		// The house style without the restriction: always legal.
		var loose = new SheddingRulesConfig { WildDrawRequiresNoMatch = false };
		Assert.True(SheddingRulebook.CanPlay(Catalog["wild4"], holding, state, loose, Catalog).Ok);
	}

	// ── The play and its effects ──────────────────────────────────────────────

	[Fact]
	public void A_play_lands_on_the_discards_and_updates_the_colour_in_force()
	{
		var a = Seat("a", "blue-5", "red-7");
		var state = State("red-5", seats: new[] { a, Seat("b") });

		var result = SheddingRulebook.Play(state, "a", "blue-5@0", null, Rules, Catalog);

		Assert.True(result.Ok);
		Assert.Equal("blue-5", state.DiscardPile[^1].CardId);
		Assert.Equal("blue", state.CurrentColor);
		Assert.False(result.SkipsNext);
	}

	[Fact]
	public void A_wild_names_the_colour_and_a_bad_colour_is_refused()
	{
		var a = Seat("a", "wild", "blue-7");
		var state = State("red-5", seats: new[] { a, Seat("b") });

		Assert.Equal("game.shedding_bad_color",
			SheddingRulebook.Play(state, "a", "wild@0", "purple", Rules, Catalog).ReasonKey);

		var result = SheddingRulebook.Play(state, "a", "wild@0", "blue", Rules, Catalog);
		Assert.True(result.Ok);
		Assert.Equal("blue", state.CurrentColor);
		Assert.Equal("blue", result.ColorInForce);
	}

	[Fact]
	public void Skip_reverse_and_penalties_report_their_effects()
	{
		var a = Seat("a", "skip-red", "rev-red", "d2-blue", "red-7");
		var state = State("red-5", seats: new[] { a, Seat("b"), Seat("c") });

		var skip = SheddingRulebook.Play(state, "a", "skip-red@0", null, Rules, Catalog);
		Assert.True(skip.SkipsNext);

		state.CurrentColor = "red";
		var reverse = SheddingRulebook.Play(state, "a", "rev-red@1", null, Rules, Catalog);
		Assert.True(reverse.Reversed);
		Assert.Equal(-1, state.Direction);
		Assert.False(reverse.SkipsNext); // three players: the reverse is not a skip

		state.CurrentColor = "blue";
		var draw2 = SheddingRulebook.Play(state, "a", "d2-blue@2", null, Rules, Catalog);
		Assert.Equal(2, draw2.PenaltyDraws);
		Assert.True(draw2.SkipsNext);
	}

	[Fact]
	public void A_two_player_reverse_acts_as_a_skip()
	{
		var a = Seat("a", "rev-red", "red-7");
		var state = State("red-5", seats: new[] { a, Seat("b") });

		var result = SheddingRulebook.Play(state, "a", "rev-red@0", null, Rules, Catalog);

		Assert.True(result.Reversed);
		Assert.True(result.SkipsNext);
	}

	[Fact]
	public void Emptying_the_hand_wins_the_round()
	{
		var a = Seat("a", "red-7", "red-5");
		var state = State("red-5", seats: new[] { a, Seat("b") });

		Assert.False(SheddingRulebook.Play(state, "a", "red-7@0", null, Rules, Catalog).RoundWon);
		Assert.True(SheddingRulebook.Play(state, "a", "red-5@1", null, Rules, Catalog).RoundWon);
	}

	[Fact]
	public void Mid_pause_only_the_drawn_card_may_be_played()
	{
		var a = Seat("a", "red-7", "blue-5");
		var state = State("red-5", seats: new[] { a, Seat("b") });
		state.PendingDrawnPlay = new PendingDrawnPlay { PlayerId = "a", InstanceId = "blue-5@1" };

		Assert.Equal("game.shedding_only_drawn",
			SheddingRulebook.Play(state, "a", "red-7@0", null, Rules, Catalog).ReasonKey);

		var result = SheddingRulebook.Play(state, "a", "blue-5@1", null, Rules, Catalog);
		Assert.True(result.Ok);
		Assert.Null(state.PendingDrawnPlay); // the pause resolved with the play
	}

	// ── Doubles (house rule) ──────────────────────────────────────────────────

	[Fact]
	public void Doubles_sheds_several_identical_number_cards_at_once()
	{
		var doubles = new SheddingRulesConfig { AllowDoubles = true };
		var a = Seat("a", "red-5", "red-5", "blue-7"); // two identical red-5 (instances @0,@1)
		var state = State("red-7", color: "red", seats: new[] { a, Seat("b") });

		var result = SheddingRulebook.Play(state, "a", "red-5@0", null, doubles, Catalog,
			new List<string> { "red-5@1" });

		Assert.True(result.Ok);
		Assert.Equal(2, result.Copies);
		Assert.Single(a.Hand); // both red-5 left the hand
		Assert.Equal("red-5", state.DiscardPile[^1].CardId);
	}

	[Fact]
	public void Doubles_requires_the_rule_identical_cards_and_numbers_only()
	{
		var on = new SheddingRulesConfig { AllowDoubles = true };
		var a = Seat("a", "red-5", "red-7", "skip-red", "skip-red");
		var state = State("red-7", color: "red", seats: new[] { a, Seat("b") });

		// The rule is off by default.
		Assert.Equal("game.shedding_no_doubles",
			SheddingRulebook.Play(state, "a", "red-5@0", null, Rules, Catalog, new List<string> { "red-7@1" }).ReasonKey);
		// The extras must be IDENTICAL to the lead card.
		Assert.Equal("game.shedding_doubles_not_identical",
			SheddingRulebook.Play(state, "a", "red-5@0", null, on, Catalog, new List<string> { "red-7@1" }).ReasonKey);
		// Numbers only — actions would multiply their effect.
		Assert.Equal("game.shedding_doubles_numbers_only",
			SheddingRulebook.Play(state, "a", "skip-red@2", null, on, Catalog, new List<string> { "skip-red@3" }).ReasonKey);
	}

	[Fact]
	public void Doubles_that_empty_the_hand_win_the_round()
	{
		var doubles = new SheddingRulesConfig { AllowDoubles = true };
		var a = Seat("a", "red-5", "red-5");
		var state = State("red-7", color: "red", seats: new[] { a, Seat("b") });

		var result = SheddingRulebook.Play(state, "a", "red-5@0", null, doubles, Catalog,
			new List<string> { "red-5@1" });

		Assert.True(result.RoundWon);
		Assert.Empty(a.Hand);
	}

	// ── Stacking draw cards (house rule) ───────────────────────────────────────

	[Fact]
	public void Stacking_opens_a_penalty_and_hands_it_on_instead_of_drawing_now()
	{
		var stack = new SheddingRulesConfig { Stacking = "sameType" };
		var a = Seat("a", "d2-blue", "red-7");
		var state = State("blue-5", color: "blue", seats: new[] { a, Seat("b"), Seat("c") });

		var result = SheddingRulebook.Play(state, "a", "d2-blue@0", null, stack, Catalog);

		Assert.True(result.OpensPenaltyStack);
		Assert.Equal(2, result.PenaltyDraws); // the running total the pile now holds
		Assert.False(result.SkipsNext);       // the victim answers rather than losing the turn
	}

	[Fact]
	public void A_pending_penalty_only_admits_a_stacking_draw_card_and_totals_grow()
	{
		var same = new SheddingRulesConfig { Stacking = "sameType" };
		var a = Seat("a", "d2-blue", "red-7");
		var state = State("blue-5", color: "blue", seats: new[] { a, Seat("b") });
		state.PendingPenalty = new SheddingPenalty { Amount = 2, LastType = "drawTwo" };

		// A non-draw card cannot answer a penalty.
		Assert.Equal("game.shedding_must_stack",
			SheddingRulebook.CanPlay(Catalog["red-7"], a, state, same, Catalog).ReasonKey);
		// Another +2 stacks — colour is bypassed — and the total climbs to 4.
		var result = SheddingRulebook.Play(state, "a", "d2-blue@0", null, same, Catalog);
		Assert.True(result.OpensPenaltyStack);
		Assert.Equal(4, result.PenaltyDraws);
	}

	[Fact]
	public void SameType_forbids_crossing_kinds_cross_allows_it()
	{
		var a = Seat("a", "wild4", "blue-7");
		var state = State("blue-5", color: "blue", seats: new[] { a, Seat("b") });
		state.PendingPenalty = new SheddingPenalty { Amount = 2, LastType = "drawTwo" };

		// sameType: a +4 cannot answer a +2.
		Assert.False(SheddingRulebook.CanPlay(
			Catalog["wild4"], a, state, new SheddingRulesConfig { Stacking = "sameType" }, Catalog).Ok);
		// cross: it can, adding four to the pile.
		var cross = new SheddingRulesConfig { Stacking = "cross" };
		Assert.True(SheddingRulebook.CanPlay(Catalog["wild4"], a, state, cross, Catalog).Ok);
		var result = SheddingRulebook.Play(state, "a", "wild4@0", "blue", cross, Catalog);
		Assert.True(result.OpensPenaltyStack);
		Assert.Equal(6, result.PenaltyDraws);
	}

	// ── Last-card declaration (house rule) ─────────────────────────────────────

	[Fact]
	public void DeclareLastCard_clears_the_hook_only_for_the_player_on_it()
	{
		var state = State("red-5", seats: new[] { Seat("a"), Seat("b") });
		state.PendingLastCardCall = "a";

		Assert.False(SheddingRulebook.DeclareLastCard(state, "b")); // not b's hook
		Assert.Equal("a", state.PendingLastCardCall);
		Assert.True(SheddingRulebook.DeclareLastCard(state, "a"));  // a declares
		Assert.Null(state.PendingLastCardCall);
	}

	[Fact]
	public void CatchLastCard_returns_the_exposed_player_but_never_yourself_or_nobody()
	{
		var state = State("red-5", seats: new[] { Seat("a"), Seat("b") });

		Assert.Null(SheddingRulebook.CatchLastCard(state, "b")); // nobody on the hook
		state.PendingLastCardCall = "a";
		Assert.Null(SheddingRulebook.CatchLastCard(state, "a")); // can't catch yourself
		Assert.Equal("a", state.PendingLastCardCall);                // still on the hook
		Assert.Equal("a", SheddingRulebook.CatchLastCard(state, "b")); // b catches a
		Assert.Null(state.PendingLastCardCall);                      // the hook cleared
	}

	[Fact]
	public void With_stacking_off_a_draw_card_lands_the_classic_way()
	{
		var a = Seat("a", "d2-blue", "red-7");
		var state = State("blue-5", color: "blue", seats: new[] { a, Seat("b") });

		var result = SheddingRulebook.Play(state, "a", "d2-blue@0", null, Rules, Catalog);

		Assert.False(result.OpensPenaltyStack);
		Assert.Equal(2, result.PenaltyDraws);
		Assert.True(result.SkipsNext); // classic: the victim draws now and is skipped
	}

	// ── Drawing ───────────────────────────────────────────────────────────────

	[Fact]
	public void Drawing_reshuffles_the_buried_discards_keeping_the_top()
	{
		var a = Seat("a");
		var state = State("red-5", seats: new[] { a, Seat("b") });
		state.DiscardPile.Insert(0, Inst("blue-7", 1)); // buried under the top
		state.DiscardPile.Insert(0, Inst("blue-5", 1));
		SheddingRulebook.SyncCounts(state);

		var drawn = SheddingRulebook.DrawInto(state, a, 3, new ScriptedRandomSource());

		Assert.Equal(2, drawn.Count); // only the two buried cards existed to draw
		Assert.Single(state.DiscardPile);
		Assert.Equal("red-5@9", state.DiscardPile[0].InstanceId); // the top never moves
	}

	// ── The turn walk ─────────────────────────────────────────────────────────

	[Fact]
	public void The_turn_walk_honours_direction_skips_and_retired_chairs()
	{
		var state = State("red-5", seats: new[] { Seat("a"), Seat("b"), Seat("c"), Seat("d") });

		Assert.Equal("b", SheddingRulebook.NextPlayer(state, "a"));
		Assert.Equal("c", SheddingRulebook.NextPlayer(state, "a", skipOne: true));

		state.Direction = -1;
		Assert.Equal("d", SheddingRulebook.NextPlayer(state, "a"));

		state.Direction = 1;
		state.Seats[1].Retired = true; // b's chair empties
		Assert.Equal("c", SheddingRulebook.NextPlayer(state, "a"));
		Assert.Equal("d", SheddingRulebook.NextPlayer(state, "a", skipOne: true));
	}

	// ── Round scoring and retirement ──────────────────────────────────────────

	[Fact]
	public void The_round_winner_collects_the_classic_points_from_every_rival_hand()
	{
		var a = Seat("a");
		var b = Seat("b", "red-7", "skip-red"); // 7 + 20
		var c = Seat("c", "wild4");             // 50
		var state = State("red-5", seats: new[] { a, b, c });

		var score = SheddingRulebook.ScoreRound(state, "a", Catalog);

		Assert.Equal(77, score.Points);
		Assert.Equal(77, a.Score);
		Assert.Equal(new List<int> { 77 }, a.RoundScores);
		Assert.Equal(new List<int> { 0 }, b.RoundScores);
		Assert.All(state.Seats, s => Assert.Empty(s.Hand));
	}

	[Fact]
	public void A_package_may_override_a_card_s_points()
	{
		var custom = new SheddingCardDef { Id = "x", Type = "skip", Color = "red", Points = 5 };
		Assert.Equal(5, SheddingRulebook.PointsOf(custom));
		Assert.Equal(20, SheddingRulebook.PointsOf(Catalog["skip-red"]));
		Assert.Equal(50, SheddingRulebook.PointsOf(Catalog["wild"]));
		Assert.Equal(7, SheddingRulebook.PointsOf(Catalog["red-7"]));
	}

	[Fact]
	public void Retire_slides_the_hand_under_the_discards_and_clears_the_pause()
	{
		var c = Seat("c", "red-7", "wild");
		var state = State("red-5", seats: new[] { Seat("a"), Seat("b"), c });
		state.PendingDrawnPlay = new PendingDrawnPlay { PlayerId = "c", InstanceId = "red-7@0" };

		SheddingRulebook.Retire(state, "c");

		Assert.True(c.Retired);
		Assert.Empty(c.Hand);
		Assert.Null(state.PendingDrawnPlay);
		Assert.Equal(3, state.DiscardPile.Count);
		Assert.Equal("red-5@9", state.DiscardPile[^1].InstanceId); // the top stays the top
		Assert.DoesNotContain(SheddingRulebook.Placings(state), s => s.PlayerId == "c");
	}
}
