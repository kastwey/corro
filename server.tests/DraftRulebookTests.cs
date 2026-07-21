using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Pure rules of the draft family (simultaneous pick-and-pass): dealing on the classic
/// base-minus-players curve, the secret re-pickable commit, the reveal (dessert stash,
/// multiplier catch, leftward rotation), round scoring (points × multiplier, sets, scale
/// ladders, the majority race) and the end-of-game dessert race with its placings.
/// </summary>
public class DraftRulebookTests
{
	private static List<DraftCardDef> Deck() => new()
	{
		new() { Id = "bite1", Type = "points", Value = 1, Count = 6, NameKey = "c.bite1" },
		new() { Id = "bite3", Type = "points", Value = 3, Count = 6, NameKey = "c.bite3" },
		new() { Id = "sauce", Type = "multiplier", Factor = 3, Count = 4, NameKey = "c.sauce" },
		new() { Id = "pair", Type = "set", SetSize = 2, SetPoints = 5, Count = 8, NameKey = "c.pair" },
		new() { Id = "trio", Type = "set", SetSize = 3, SetPoints = 10, Count = 8, NameKey = "c.trio" },
		new() { Id = "olive", Type = "scale", Scale = new() { 1, 3, 6, 10, 15 }, Count = 8, NameKey = "c.olive" },
		new() { Id = "icon1", Type = "majority", Icons = 1, Count = 6, NameKey = "c.icon1" },
		new() { Id = "icon3", Type = "majority", Icons = 3, Count = 6, NameKey = "c.icon3" },
		new() { Id = "caramel-custard", Type = "dessert", Count = 8, NameKey = "c.flan" },
		new() { Id = "stick", Type = "extra", Count = 4, NameKey = "c.stick" },
	};

	private static readonly Dictionary<string, DraftCardDef> Catalog = DraftRulebook.Catalog(Deck());
	private static readonly DraftRulesConfig Rules = new();

	private static DraftCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}@{n}", CardId = cardId };

	private static DraftSeatState Seat(string id, params string[] hand)
		=> new() { PlayerId = id, Hand = hand.Select((c, i) => Inst(c, i)).ToList() };

	private static DraftState State(params DraftSeatState[] seats)
	{
		var state = new DraftState { Seats = seats.ToList() };
		DraftRulebook.SyncCounts(state);
		return state;
	}

	private static DraftTableSlot OnTable(string cardId, int n = 0) => new() { Card = Inst(cardId, n) };

	// ── Construction and dealing ──────────────────────────────────────────────

	[Fact]
	public void CreateInitialState_deals_the_base_minus_players_curve_and_syncs_counts()
	{
		var rules = new DraftRulesConfig { HandSizeBase = 5 };
		var state = DraftRulebook.CreateInitialState(new[] { "a", "b" }, Deck(), rules, new ScriptedRandomSource());

		Assert.Equal(1, state.Round);
		Assert.Equal(1, state.Trick);
		Assert.All(state.Seats, s => Assert.Equal(3, s.Hand.Count));
		Assert.All(state.Seats, s => Assert.Equal(3, s.HandCount));
		var total = Deck().Sum(c => c.Count);
		Assert.Equal(total - 6, state.DrawCount);
	}

	[Fact]
	public void The_identity_shuffle_deals_round_robin_from_the_deck_tail()
	{
		// The E2E environment's scripted source shuffles as the identity, so the pile stays
		// in cards.json order and the deal pops its TAIL round-robin — known hands.
		var rules = new DraftRulesConfig { HandSizeBase = 4 };
		var state = DraftRulebook.CreateInitialState(new[] { "a", "b" }, Deck(), rules, new ScriptedRandomSource());

		Assert.Equal(new[] { "stick#3", "stick#1" }, state.Seats[0].Hand.Select(c => c.InstanceId));
		Assert.Equal(new[] { "stick#2", "stick#0" }, state.Seats[1].Hand.Select(c => c.InstanceId));
	}

	// ── The simultaneous pick ─────────────────────────────────────────────────

	[Fact]
	public void Commit_refuses_a_card_not_in_the_hand_and_an_unseated_player()
	{
		var state = State(Seat("a", "bite1"));

		Assert.Equal("game.draft_not_in_hand",
			DraftRulebook.Commit(state, "a", "ghost", null, Catalog).ReasonKey);
		Assert.Equal("game.draft_not_seated",
			DraftRulebook.Commit(state, "nobody", "bite1@0", null, Catalog).ReasonKey);
	}

	[Fact]
	public void The_last_commit_reports_all_committed()
	{
		var state = State(Seat("a", "bite1", "pair"), Seat("b", "bite3", "trio"));

		var first = DraftRulebook.Commit(state, "a", "bite1@0", null, Catalog);
		Assert.True(first.Ok);
		Assert.False(first.AllCommitted);
		Assert.True(state.Seats[0].HasPicked);

		var last = DraftRulebook.Commit(state, "b", "bite3@0", null, Catalog);
		Assert.True(last.AllCommitted);
	}

	[Fact]
	public void A_second_commit_replaces_the_first_while_nothing_is_revealed()
	{
		var state = State(Seat("a", "bite1", "pair"), Seat("b", "bite3"));

		DraftRulebook.Commit(state, "a", "bite1@0", null, Catalog);
		var repick = DraftRulebook.Commit(state, "a", "pair@1", null, Catalog);

		Assert.True(repick.Ok);
		Assert.True(repick.Replaced);
		Assert.Equal("pair@1", state.Seats[0].CommittedInstanceId);
	}

	[Fact]
	public void A_second_card_needs_an_unspent_extra_and_two_DISTINCT_cards()
	{
		var state = State(Seat("a", "bite3", "bite1"), Seat("b", "trio"));

		Assert.Equal("game.draft_needs_extra",
			DraftRulebook.Commit(state, "a", "bite3@0", "bite1@1", Catalog).ReasonKey);
		Assert.Equal("game.draft_same_card",
			DraftRulebook.Commit(state, "a", "bite3@0", "bite3@0", Catalog).ReasonKey);

		state.Seats[0].Table.Add(OnTable("stick"));
		var ok = DraftRulebook.Commit(state, "a", "bite3@0", "bite1@1", Catalog);
		Assert.True(ok.Ok);
		Assert.Equal("bite1", ok.SecondCard?.Id);
	}

	// ── The reveal ────────────────────────────────────────────────────────────

	[Fact]
	public void Reveal_lands_every_pick_and_rotates_the_hands_left()
	{
		var a = Seat("a", "bite1", "pair");
		var b = Seat("b", "bite3", "trio");
		var state = State(a, b);
		DraftRulebook.Commit(state, "a", "bite1@0", null, Catalog);
		DraftRulebook.Commit(state, "b", "bite3@0", null, Catalog);

		var result = DraftRulebook.Reveal(state, Catalog);

		Assert.False(result.RoundEnded);
		Assert.Equal(2, result.Entries.Count);
		Assert.Equal("bite1", Assert.Single(a.Table).Card.CardId);
		Assert.Equal("bite3", Assert.Single(b.Table).Card.CardId);
		// a's leftover [pair] travelled LEFT to b; b's [trio] wrapped around to a.
		Assert.Equal("trio@1", Assert.Single(a.Hand).InstanceId);
		Assert.Equal("pair@1", Assert.Single(b.Hand).InstanceId);
		Assert.Equal(2, state.Trick);
		Assert.All(state.Seats, s => Assert.False(s.HasPicked));
	}

	[Fact]
	public void A_dessert_goes_to_the_stash_not_the_table()
	{
		var a = Seat("a", "caramel-custard", "bite1");
		var state = State(a, Seat("b", "bite3", "trio"));
		DraftRulebook.Commit(state, "a", "caramel-custard@0", null, Catalog);
		DraftRulebook.Commit(state, "b", "bite3@0", null, Catalog);

		DraftRulebook.Reveal(state, Catalog);

		Assert.Empty(a.Table);
		Assert.Equal("caramel-custard", Assert.Single(a.Desserts).CardId);
	}

	[Fact]
	public void A_points_card_lands_on_a_multiplier_placed_on_an_EARLIER_trick()
	{
		var a = Seat("a", "bite3", "bite1");
		a.Table.Add(OnTable("sauce"));
		var state = State(a, Seat("b", "trio", "pair"));
		DraftRulebook.Commit(state, "a", "bite3@0", null, Catalog);
		DraftRulebook.Commit(state, "b", "trio@0", null, Catalog);

		var result = DraftRulebook.Reveal(state, Catalog);

		var slot = Assert.Single(a.Table); // the multiplier's own slot merged into the pair
		Assert.Equal("bite3", slot.Card.CardId);
		Assert.Equal("sauce", slot.OnMultiplier?.CardId);
		Assert.Equal("sauce", result.Entries.Single(e => e.Seat == a).Multiplier?.Id);
	}

	[Fact]
	public void A_multiplier_revealed_this_trick_cannot_catch_anything_yet()
	{
		var a = Seat("a", "sauce", "bite3");
		var state = State(a, Seat("b", "trio", "pair"));
		DraftRulebook.Commit(state, "a", "sauce@0", null, Catalog);
		DraftRulebook.Commit(state, "b", "trio@0", null, Catalog);

		DraftRulebook.Reveal(state, Catalog);

		var slot = Assert.Single(a.Table);
		Assert.Equal("sauce", slot.Card.CardId);
		Assert.Null(slot.OnMultiplier);
	}

	[Fact]
	public void A_double_pick_resolves_in_order_and_the_extra_rejoins_the_passing_hand()
	{
		// a spends her table "stick": sauce FIRST, bite3 SECOND — so the points card
		// lands on the multiplier revealed the same trick (the classic chopsticks ruling).
		var a = Seat("a", "sauce", "bite3", "pair");
		a.Table.Add(OnTable("stick", 7));
		var b = Seat("b", "trio", "olive", "bite1");
		var state = State(a, b);
		DraftRulebook.Commit(state, "a", "sauce@0", "bite3@1", Catalog);
		DraftRulebook.Commit(state, "b", "trio@0", null, Catalog);

		var result = DraftRulebook.Reveal(state, Catalog);

		var slot = Assert.Single(a.Table); // sauce merged under bite3; the stick is GONE
		Assert.Equal("bite3", slot.Card.CardId);
		Assert.Equal("sauce", slot.OnMultiplier?.CardId);

		var boosted = result.Entries.Single(e => e.Card.Id == "bite3");
		Assert.Equal("sauce", boosted.Multiplier?.Id);
		Assert.Equal("stick", boosted.SpentExtra?.Id); // the voice names what paid

		// The spent stick rode a's leftover hand LEFT into b's; sizes stay symmetric.
		Assert.Contains(b.Hand, c => c.InstanceId == "stick@7");
		Assert.Equal(2, a.Hand.Count);
		Assert.Equal(2, b.Hand.Count);
	}

	[Fact]
	public void A_double_pick_points_first_gains_no_boost()
	{
		var a = Seat("a", "bite3", "sauce", "pair");
		a.Table.Add(OnTable("stick"));
		var state = State(a, Seat("b", "trio", "olive", "bite1"));
		DraftRulebook.Commit(state, "a", "bite3@0", "sauce@1", Catalog);
		DraftRulebook.Commit(state, "b", "trio@0", null, Catalog);

		DraftRulebook.Reveal(state, Catalog);

		Assert.Null(a.Table.Single(s => s.Card.CardId == "bite3").OnMultiplier);
		Assert.Contains(a.Table, s => s.Card.CardId == "sauce"); // waiting for a later trick
	}

	[Fact]
	public void An_unspent_extra_scores_nothing_and_leaves_with_the_round()
	{
		var a = Seat("a");
		a.Table.Add(OnTable("stick"));
		var state = State(a, Seat("b"));

		var scores = DraftRulebook.ScoreRound(state, Catalog, Rules);

		Assert.Equal(0, scores.Single(s => s.Seat == a).Points);
		Assert.Empty(a.Table);
	}

	[Fact]
	public void Revealing_the_last_cards_ends_the_round_without_rotation()
	{
		var state = State(Seat("a", "bite1"), Seat("b", "bite3"));
		DraftRulebook.Commit(state, "a", "bite1@0", null, Catalog);
		DraftRulebook.Commit(state, "b", "bite3@0", null, Catalog);

		var result = DraftRulebook.Reveal(state, Catalog);

		Assert.True(result.RoundEnded);
		Assert.All(state.Seats, s => Assert.Empty(s.Hand));
		Assert.Equal(1, state.Trick);
	}

	// ── Round scoring ─────────────────────────────────────────────────────────

	[Fact]
	public void ScoreRound_adds_points_sets_and_scales_then_clears_the_tables()
	{
		var a = Seat("a");
		a.Table.Add(new DraftTableSlot { Card = Inst("bite3"), OnMultiplier = Inst("sauce") }); // 9
		a.Table.Add(OnTable("pair", 0)); a.Table.Add(OnTable("pair", 1)); a.Table.Add(OnTable("pair", 2)); // 5 (one group + spare)
		a.Table.Add(OnTable("olive", 0)); a.Table.Add(OnTable("olive", 1)); // ladder step 2 = 3
		var b = Seat("b");
		b.Table.Add(OnTable("bite1")); // 1
		b.Table.Add(OnTable("trio", 0)); b.Table.Add(OnTable("trio", 1)); b.Table.Add(OnTable("trio", 2)); // 10
		b.Desserts.Add(Inst("caramel-custard"));
		var state = State(a, b);

		var scores = DraftRulebook.ScoreRound(state, Catalog, Rules);

		Assert.Equal(17, scores.Single(s => s.Seat == a).Points);
		Assert.Equal(11, scores.Single(s => s.Seat == b).Points);
		Assert.Equal(17, a.Score);
		Assert.Equal(new List<int> { 17 }, a.RoundScores);
		Assert.All(state.Seats, s => Assert.Empty(s.Table));
		Assert.Single(b.Desserts); // desserts survive the round sweep
	}

	[Fact]
	public void An_unattached_multiplier_scores_nothing()
	{
		var a = Seat("a");
		a.Table.Add(OnTable("sauce"));
		var state = State(a, Seat("b"));

		var scores = DraftRulebook.ScoreRound(state, Catalog, Rules);

		Assert.Equal(0, scores.Single(s => s.Seat == a).Points);
	}

	[Fact]
	public void The_scale_ladder_caps_at_its_last_step()
	{
		var a = Seat("a");
		for (var n = 0; n < 7; n++)
		{
			a.Table.Add(OnTable("olive", n)); // ladder tops out at 15
		}

		var state = State(a, Seat("b"));

		Assert.Equal(15, DraftRulebook.ScoreRound(state, Catalog, Rules).Single(s => s.Seat == a).Points);
	}

	[Fact]
	public void Majority_unique_first_takes_the_prize_and_the_runner_up_the_second()
	{
		var a = Seat("a"); a.Table.Add(OnTable("icon3"));
		var b = Seat("b"); b.Table.Add(OnTable("icon1"));
		var c = Seat("c");
		var state = State(a, b, c);

		var prizes = DraftRulebook.MajorityPrizes(state, Catalog, Rules);

		Assert.Equal(6, prizes.Single(p => p.PlayerId == "a").Prize);
		Assert.Equal(3, prizes.Single(p => p.PlayerId == "b").Prize);
		Assert.DoesNotContain(prizes, p => p.PlayerId == "c");
	}

	[Fact]
	public void A_tie_up_top_splits_the_first_prize_and_eats_the_second()
	{
		var a = Seat("a"); a.Table.Add(OnTable("icon3"));
		var b = Seat("b"); b.Table.Add(OnTable("icon3", 1));
		var c = Seat("c"); c.Table.Add(OnTable("icon1"));
		var state = State(a, b, c);

		var prizes = DraftRulebook.MajorityPrizes(state, Catalog, Rules);

		Assert.Equal(3, prizes.Single(p => p.PlayerId == "a").Prize);
		Assert.Equal(3, prizes.Single(p => p.PlayerId == "b").Prize);
		Assert.DoesNotContain(prizes, p => p.PlayerId == "c"); // no second prize after a tie
	}

	[Fact]
	public void No_icons_on_any_table_means_no_majority_prizes()
	{
		var state = State(Seat("a"), Seat("b"));
		Assert.Empty(DraftRulebook.MajorityPrizes(state, Catalog, Rules));
	}

	// ── Desserts and placings ─────────────────────────────────────────────────

	[Fact]
	public void Desserts_pay_the_most_and_charge_the_fewest()
	{
		var a = Seat("a"); a.Desserts.Add(Inst("caramel-custard", 0)); a.Desserts.Add(Inst("caramel-custard", 1));
		var b = Seat("b"); b.Desserts.Add(Inst("caramel-custard", 2));
		var c = Seat("c");
		var state = State(a, b, c);

		var scores = DraftRulebook.ScoreDesserts(state, Rules);

		Assert.Equal(6, scores.Single(s => s.Seat == a).Delta);
		Assert.Equal(-6, scores.Single(s => s.Seat == c).Delta);
		Assert.DoesNotContain(scores, s => s.Seat == b);
	}

	[Fact]
	public void Two_player_games_skip_the_dessert_penalty()
	{
		var a = Seat("a"); a.Desserts.Add(Inst("caramel-custard"));
		var b = Seat("b");
		var state = State(a, b);

		var scores = DraftRulebook.ScoreDesserts(state, Rules);

		Assert.Equal(6, Assert.Single(scores).Delta); // a's bonus; b loses nothing
	}

	[Fact]
	public void Everyone_tied_on_desserts_just_splits_the_bonus()
	{
		var a = Seat("a"); a.Desserts.Add(Inst("caramel-custard", 0));
		var b = Seat("b"); b.Desserts.Add(Inst("caramel-custard", 1));
		var c = Seat("c"); c.Desserts.Add(Inst("caramel-custard", 2));
		var state = State(a, b, c);

		var scores = DraftRulebook.ScoreDesserts(state, Rules);

		Assert.Equal(3, scores.Count);
		Assert.All(scores, s => Assert.Equal(2, s.Delta)); // 6 / 3, nobody also penalized
	}

	[Fact]
	public void Placings_order_by_score_with_the_dessert_stash_as_tiebreaker()
	{
		var a = Seat("a"); a.Score = 30;
		var b = Seat("b"); b.Score = 30; b.Desserts.Add(Inst("caramel-custard"));
		var c = Seat("c"); c.Score = 40;
		var state = State(a, b, c);

		Assert.Equal(new[] { "c", "b", "a" }, DraftRulebook.Placings(state).Select(s => s.PlayerId));
	}

	// ── Retirement (the shared leave-game flow) ───────────────────────────────

	[Fact]
	public void Retiring_the_last_holdout_folds_the_seat_and_completes_the_trick()
	{
		var a = Seat("a", "bite1", "pair");
		var b = Seat("b", "bite3", "trio");
		var c = Seat("c", "olive", "caramel-custard");
		c.Table.Add(OnTable("icon3"));
		var state = State(a, b, c);
		DraftRulebook.Commit(state, "a", "bite1@0", null, Catalog);
		DraftRulebook.Commit(state, "b", "bite3@0", null, Catalog);

		// c walks: the fold removes the only missing pick — the caller must reveal.
		Assert.True(DraftRulebook.Retire(state, "c"));
		Assert.True(c.Retired);
		Assert.Empty(c.Hand);          // their cards leave the game…
		Assert.Empty(c.Table);         // …including the unscored table
		Assert.True(DraftRulebook.TrickComplete(state));

		// A second retire is inert, and a retired seat can no longer pick.
		Assert.False(DraftRulebook.Retire(state, "c"));
		Assert.Equal("game.draft_not_seated",
			DraftRulebook.Commit(state, "c", "olive@0", null, Catalog).ReasonKey);
	}

	[Fact]
	public void Retiring_with_no_pick_pending_asks_for_no_reveal()
	{
		var state = State(Seat("a", "bite1"), Seat("b", "bite3"), Seat("c", "olive"));
		Assert.False(DraftRulebook.Retire(state, "c")); // nobody was waiting on anyone
	}

	[Fact]
	public void The_rotation_passes_THROUGH_a_retired_seat()
	{
		var a = Seat("a", "bite1", "pair");
		var b = Seat("b", "bite3", "trio");
		var c = Seat("c", "olive", "caramel-custard");
		var state = State(a, b, c);
		DraftRulebook.Retire(state, "b"); // the middle chair empties
		DraftRulebook.Commit(state, "a", "bite1@0", null, Catalog);
		DraftRulebook.Commit(state, "c", "olive@0", null, Catalog);

		DraftRulebook.Reveal(state, Catalog);

		// a's leftover skipped b and landed on c; c's wrapped around to a.
		Assert.Equal("pair@1", Assert.Single(c.Hand).InstanceId);
		Assert.Equal("caramel-custard@1", Assert.Single(a.Hand).InstanceId);
		Assert.Empty(b.Hand);
	}

	[Fact]
	public void The_deal_and_the_races_skip_retired_seats()
	{
		var rules = new DraftRulesConfig { HandSizeBase = 5 };
		var state = DraftRulebook.CreateInitialState(new[] { "a", "b", "c" }, Deck(), rules, new ScriptedRandomSource());
		foreach (var seat in state.Seats)
		{
			seat.Hand.Clear();
		}

		DraftRulebook.Retire(state, "c");
		DraftRulebook.DealRound(state, rules);

		Assert.Equal(2, DraftRulebook.SeatOf(state, "a").Hand.Count);
		Assert.Empty(DraftRulebook.SeatOf(state, "c").Hand);

		// Desserts: the retired stash is inert, and TWO active racers get the
		// two-player kindness (no penalty) even at a three-chair table.
		DraftRulebook.SeatOf(state, "c").Desserts.AddRange(new[] { Inst("caramel-custard", 5), Inst("caramel-custard", 6) });
		DraftRulebook.SeatOf(state, "a").Desserts.Add(Inst("caramel-custard", 7));
		var desserts = DraftRulebook.ScoreDesserts(state, Rules);
		Assert.Equal(6, Assert.Single(desserts).Delta);
		Assert.Equal("a", Assert.Single(desserts).Seat.PlayerId);

		// Placings rank only the seats that finished.
		Assert.DoesNotContain(DraftRulebook.Placings(state), s => s.PlayerId == "c");
	}
}
