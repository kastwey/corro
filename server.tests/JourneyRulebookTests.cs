using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Pure rules of the journey family (Mil Millas genre): legality of every card type, the
/// initial-hazard trick (the green light is just a remedy), the coup fourré interrupt, hand
/// end, the official scoring table and the match across hands. All randomness is injected.
/// </summary>
public class JourneyRulebookTests
{
	// A compact classic-shaped catalog: distances (200 is premium and twice per hand),
	// stopper + limiter attacks, their remedies, and two immunities (one multi-shield).
	private static List<JourneyCardDef> Deck() => new()
	{
		new() { Id = "distance-25", Type = "distance", Value = 25, Count = 6, NameKey = "cards.distance_25" },
		new() { Id = "distance-200", Type = "distance", Value = 200, Count = 4, Premium = true, MaxPlaysPerHand = 2, NameKey = "cards.distance_200" },
		new() { Id = "stop", Type = "attack", Kind = "stop", HazardClass = "stopper", Count = 3, NameKey = "cards.stop" },
		new() { Id = "flat", Type = "attack", Kind = "flat", HazardClass = "stopper", Count = 2, NameKey = "cards.flat" },
		new() { Id = "limit", Type = "attack", Kind = "speedLimit", HazardClass = "limiter", Count = 2, NameKey = "cards.limit" },
		new() { Id = "go", Type = "remedy", Kind = "stop", Count = 6, NameKey = "cards.go" },
		new() { Id = "spare", Type = "remedy", Kind = "flat", Count = 2, NameKey = "cards.spare" },
		new() { Id = "endlimit", Type = "remedy", Kind = "speedLimit", Count = 2, NameKey = "cards.endlimit" },
		new() { Id = "priority", Type = "immunity", ShieldsKinds = new() { "stop", "speedLimit" }, NameKey = "cards.priority" },
		new() { Id = "solid", Type = "immunity", Kind = "flat", NameKey = "cards.sunid" },
	};

	private static readonly IReadOnlyDictionary<string, JourneyCardDef> Cat = JourneyRulebook.Catalog(Deck());
	private static JourneyCardDef Def(string id) => Cat[id];
	private static JourneyRulesConfig Rules(int goal = 1000, bool stack = false, int target = 5000)
		=> new() { GoalKm = goal, StackHazards = stack, TargetScore = target };

	private static JourneyCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}#{n}", CardId = cardId };

	private static JourneySeatState Seat(string id, params string[] hazards)
	{
		var seat = new JourneySeatState
		{
			PlayerId = id,
			Members = new() { new JourneyMemberState { PlayerId = id } },
		};
		seat.Hazards.AddRange(hazards);
		return seat;
	}

	/// <summary>Individual seatings: every player a one-member seat.</summary>
	private static List<string[]> Solo(params string[] ids) => ids.Select(id => new[] { id }).ToList();

	/// <summary>A shared TEAM seat (no hazards: rolling, so it is attackable in tests).</summary>
	private static JourneySeatState TeamSeat(params string[] ids) => new()
	{
		PlayerId = ids[0],
		Members = ids.Select(id => new JourneyMemberState { PlayerId = id }).ToList(),
	};

	private static JourneyState Game(params JourneySeatState[] seats)
	{
		var state = new JourneyState();
		state.Seats.AddRange(seats);
		JourneyRulebook.SyncCounts(state);
		return state;
	}

	// ── Hand construction ─────────────────────────────────────────────────────

	[Fact]
	public void Initial_state_deals_hands_and_everyone_starts_stopped()
	{
		var state = JourneyRulebook.CreateInitialState(Solo("A", "B"), Deck(), Rules(), new ScriptedRandomSource());

		Assert.All(state.Seats, s => Assert.Equal(6, s.Members[0].Hand.Count));
		Assert.All(state.Seats, s => Assert.Equal(new[] { "stop" }, s.Hazards));
		// The green light is just a remedy for that initial hazard — no special start rule.
		Assert.True(JourneyRulebook.IsStopped(state.Seats[0], Cat));

		var totalCopies = Deck().Sum(c => c.Count);
		Assert.Equal(totalCopies - 12, state.DrawPile.Count);
		Assert.Equal(state.DrawPile.Count, state.DrawCount);
		Assert.All(state.Seats, s => Assert.Equal(6, s.Members[0].HandCount));
		// Every physical instance is unique (focus stability and projections rely on it).
		var all = state.DrawPile.Concat(state.Seats.SelectMany(s => s.Members[0].Hand)).Select(c => c.InstanceId).ToList();
		Assert.Equal(all.Count, all.Distinct().Count());
	}

	// ── Teams: one shared seat, hands per member ──────────────────────────────

	[Fact]
	public void Team_seatings_share_the_seat_and_deal_every_member_their_own_hand()
	{
		var state = JourneyRulebook.CreateInitialState(
			new[] { new[] { "A", "C" }, new[] { "B", "D" } }, Deck(), Rules(), new ScriptedRandomSource());

		Assert.Equal(2, state.Seats.Count);
		Assert.Equal(new[] { "A", "C" }, state.Seats[0].Members.Select(m => m.PlayerId));
		Assert.All(state.Seats.SelectMany(s => s.Members), m => Assert.Equal(6, m.Hand.Count));
		// Any member id resolves to the SHARED seat; hands stay personal.
		Assert.Same(JourneyRulebook.SeatOf(state, "A"), JourneyRulebook.SeatOf(state, "C"));
		Assert.NotSame(JourneyRulebook.MemberOf(state, "A"), JourneyRulebook.MemberOf(state, "C"));
	}

	[Fact]
	public void A_member_plays_their_OWN_cards_onto_the_shared_seat_and_cannot_attack_their_partner()
	{
		var us = TeamSeat("A", "C");
		us.Members[1].Hand.Add(Inst("distance-25"));  // C holds the 25…
		us.Members[1].Hand.Add(Inst("stop")); // …and the attack
		var them = TeamSeat("B", "D");
		var state = Game(us, them);

		// C's card is not in A's hand: partners never play each other's cards.
		Assert.Equal("game.journey_card_not_in_hand",
			JourneyRulebook.Play(state, "A", "distance-25#0", null, Rules(), Cat).ReasonKey);

		// C plays it: the kilometres land on the SHARED seat.
		Assert.True(JourneyRulebook.Play(state, "C", "distance-25#0", null, Rules(), Cat).Ok);
		Assert.Equal(25, us.Km);

		// Attacking your partner is attacking your own seat: refused.
		Assert.Equal("game.journey_needs_target",
			JourneyRulebook.Play(state, "C", "stop#0", "A", Rules(), Cat).ReasonKey);
	}

	[Fact]
	public void The_partner_holding_the_shield_gets_the_coup_and_answers_it()
	{
		var me = Seat("A");
		me.Members[0].Hand.Add(Inst("stop"));
		var them = TeamSeat("B", "D");
		them.Members[1].Hand.Add(Inst("priority")); // D — not the named target B — holds it
		var state = Game(me, them);
		state.DrawPile.Add(Inst("distance-25", 9));

		var played = JourneyRulebook.Play(state, "A", "stop#0", "B", Rules(), Cat);
		Assert.True(played.CoupOffered);
		Assert.Contains("stop", them.Hazards);
		Assert.Equal("D", state.PendingCoup!.VictimId); // the HOLDER answers, whoever was aimed at

		var coup = JourneyRulebook.ResolveCoup(state, "D", accept: true, Cat);
		Assert.True(coup.Accepted);
		Assert.DoesNotContain("stop", them.Hazards);
		Assert.Equal(1, them.CoupFourres); // the SEAT banks the bonus
		Assert.Equal("distance-25#9", them.Members[1].Hand.Single().InstanceId); // D drew the replacement
	}

	// ── Legality ──────────────────────────────────────────────────────────────

	[Fact]
	public void Distance_is_blocked_while_stopped_and_flows_after_the_green_light()
	{
		var me = Seat("A", "stop");
		Assert.Equal("game.journey_stopped", JourneyRulebook.CanPlay(Def("distance-25"), me, null, Rules(), Cat).ReasonKey);

		me.Hazards.Remove("stop");
		Assert.True(JourneyRulebook.CanPlay(Def("distance-25"), me, null, Rules(), Cat).Ok);
	}

	[Fact]
	public void A_speed_limit_caps_the_distance_value_until_cured()
	{
		var me = Seat("A", "speedLimit");
		Assert.Equal("game.journey_over_limit", JourneyRulebook.CanPlay(Def("distance-200"), me, null, Rules(), Cat).ReasonKey);
		Assert.True(JourneyRulebook.CanPlay(Def("distance-25"), me, null, Rules(), Cat).Ok); // 25 <= 50
	}

	[Fact]
	public void Overshooting_the_goal_is_illegal_the_finish_is_exact()
	{
		var me = Seat("A");
		me.Km = 900;
		Assert.Equal("game.journey_overshoot", JourneyRulebook.CanPlay(Def("distance-200"), me, null, Rules(), Cat).ReasonKey);
		Assert.True(JourneyRulebook.CanPlay(Def("distance-25"), me, null, Rules(), Cat).Ok);
	}

	[Fact]
	public void The_premium_card_respects_its_per_hand_play_limit()
	{
		var me = Seat("A");
		me.PlaysByCard["distance-200"] = 2;
		Assert.Equal("game.journey_card_limit", JourneyRulebook.CanPlay(Def("distance-200"), me, null, Rules(), Cat).ReasonKey);
	}

	[Fact]
	public void Attacks_need_a_rolling_unshielded_victim_without_that_hazard()
	{
		var me = Seat("A");
		var rival = Seat("B");

		Assert.Equal("game.journey_needs_target", JourneyRulebook.CanPlay(Def("stop"), me, null, Rules(), Cat).ReasonKey);
		Assert.Equal("game.journey_needs_target", JourneyRulebook.CanPlay(Def("stop"), me, me, Rules(), Cat).ReasonKey);
		Assert.True(JourneyRulebook.CanPlay(Def("stop"), me, rival, Rules(), Cat).Ok);

		rival.Immunities.Add("priority"); // shields stop + speedLimit
		Assert.Equal("game.journey_target_immune", JourneyRulebook.CanPlay(Def("stop"), me, rival, Rules(), Cat).ReasonKey);
		Assert.Equal("game.journey_target_immune", JourneyRulebook.CanPlay(Def("limit"), me, rival, Rules(), Cat).ReasonKey);
		Assert.True(JourneyRulebook.CanPlay(Def("flat"), me, rival, Rules(), Cat).Ok); // not shielded

		var stopped = Seat("C", "flat"); // already under a stopper
		Assert.Equal("game.journey_target_already", JourneyRulebook.CanPlay(Def("flat"), me, stopped, Rules(), Cat).ReasonKey);
		Assert.Equal("game.journey_target_stopped", JourneyRulebook.CanPlay(Def("stop"), me, stopped, Rules(), Cat).ReasonKey);
		// The stacking house rule lifts the rolling-victim requirement (different kinds only).
		Assert.True(JourneyRulebook.CanPlay(Def("stop"), me, stopped, Rules(stack: true), Cat).Ok);
		// A LIMITER rides its own pile: it lands on a stopped victim even officially.
		Assert.True(JourneyRulebook.CanPlay(Def("limit"), me, stopped, Rules(), Cat).Ok);
	}

	[Fact]
	public void A_remedy_needs_its_hazard_and_an_immunity_is_always_playable()
	{
		var me = Seat("A", "stop");
		Assert.True(JourneyRulebook.CanPlay(Def("go"), me, null, Rules(), Cat).Ok);
		Assert.Equal("game.journey_nothing_to_cure", JourneyRulebook.CanPlay(Def("spare"), me, null, Rules(), Cat).ReasonKey);
		Assert.True(JourneyRulebook.CanPlay(Def("priority"), me, null, Rules(), Cat).Ok);
	}

	// ── Play mechanics ────────────────────────────────────────────────────────

	[Fact]
	public void Playing_an_immunity_clears_every_hazard_it_shields()
	{
		var me = Seat("A", "stop", "speedLimit");
		me.Members[0].Hand.Add(Inst("priority"));
		var state = Game(me, Seat("B"));

		var result = JourneyRulebook.Play(state, "A", "priority#0", null, Rules(), Cat);

		Assert.True(result.Ok);
		Assert.Empty(me.Hazards);
		Assert.Equal(new[] { "priority" }, me.Immunities);
		Assert.Empty(me.Members[0].Hand);
	}

	[Fact]
	public void Curing_a_breakdown_leaves_the_car_waiting_for_the_green_light()
	{
		// Official rule: the remedy REPAIRS, it does not restart — after a flat you still
		// need the green light before rolling again.
		var me = Seat("A", "flat");
		me.Members[0].Hand.Add(Inst("spare"));
		me.Members[0].Hand.Add(Inst("go"));
		var state = Game(me, Seat("B"));

		Assert.True(JourneyRulebook.Play(state, "A", "spare#0", null, Rules(), Cat).Ok);
		Assert.Equal(new[] { "stop" }, me.Hazards); // repaired, but not rolling yet
		Assert.True(JourneyRulebook.IsStopped(me, Cat));

		Assert.True(JourneyRulebook.Play(state, "A", "go#0", null, Rules(), Cat).Ok);
		Assert.Empty(me.Hazards);
		Assert.False(JourneyRulebook.IsStopped(me, Cat));
	}

	[Fact]
	public void Right_of_way_skips_the_green_light_wait_after_a_repair()
	{
		var me = Seat("A", "flat");
		me.Immunities.Add("priority"); // shields "stop": the repair puts the car straight back
		me.Members[0].Hand.Add(Inst("spare"));
		var state = Game(me, Seat("B"));

		Assert.True(JourneyRulebook.Play(state, "A", "spare#0", null, Rules(), Cat).Ok);
		Assert.Empty(me.Hazards);
		Assert.False(JourneyRulebook.IsStopped(me, Cat));
	}

	[Fact]
	public void Ending_the_speed_limit_never_requires_a_green_light()
	{
		// The limit rides its own pile: its remedy frees the seat directly, even officially.
		var me = Seat("A", "speedLimit");
		me.Members[0].Hand.Add(Inst("endlimit"));
		var state = Game(me, Seat("B"));

		Assert.True(JourneyRulebook.Play(state, "A", "endlimit#0", null, Rules(), Cat).Ok);
		Assert.Empty(me.Hazards);
	}

	[Fact]
	public void Completing_the_goal_flags_the_hand_as_over()
	{
		var me = Seat("A");
		me.Km = 975;
		me.Members[0].Hand.Add(Inst("distance-25"));
		var state = Game(me, Seat("B"));

		var result = JourneyRulebook.Play(state, "A", "distance-25#0", null, Rules(), Cat);

		Assert.True(result.HandComplete);
		Assert.Equal(1000, me.Km);
		Assert.True(JourneyRulebook.HandOver(state, Rules()));
	}

	[Fact]
	public void An_attack_on_a_victim_holding_the_shield_pauses_on_the_coup_fourre()
	{
		var me = Seat("A");
		me.Members[0].Hand.Add(Inst("stop"));
		var victim = Seat("B");
		victim.Members[0].Hand.Add(Inst("priority"));
		var state = Game(me, victim);
		state.DrawPile.Add(Inst("distance-25", 9)); // the replacement the coup draws

		var played = JourneyRulebook.Play(state, "A", "stop#0", "B", Rules(), Cat);
		Assert.True(played.CoupOffered);
		Assert.Contains("stop", victim.Hazards); // the hazard lands; the coup may cancel it
		Assert.Equal("B", state.PendingCoup!.VictimId);

		var coup = JourneyRulebook.ResolveCoup(state, "B", accept: true, Cat);
		Assert.True(coup.Accepted);
		Assert.Null(state.PendingCoup);
		Assert.DoesNotContain("stop", victim.Hazards);
		Assert.Equal(1, victim.CoupFourres);
		Assert.Equal(new[] { "priority" }, victim.Immunities);
		Assert.Single(victim.Members[0].Hand); // the replacement card
		Assert.Equal("distance-25#9", victim.Members[0].Hand[0].InstanceId);
	}

	[Fact]
	public void Declining_the_coup_keeps_the_hazard_and_the_card()
	{
		var me = Seat("A");
		me.Members[0].Hand.Add(Inst("stop"));
		var victim = Seat("B");
		victim.Members[0].Hand.Add(Inst("priority"));
		var state = Game(me, victim);

		JourneyRulebook.Play(state, "A", "stop#0", "B", Rules(), Cat);
		var coup = JourneyRulebook.ResolveCoup(state, "B", accept: false, Cat);

		Assert.True(coup.Ok);
		Assert.False(coup.Accepted);
		Assert.Null(state.PendingCoup);
		Assert.Contains("stop", victim.Hazards);
		Assert.Single(victim.Members[0].Hand);
		Assert.Empty(victim.Immunities);
	}

	[Fact]
	public void Draw_moves_the_top_card_and_an_empty_pile_refuses()
	{
		var me = Seat("A");
		var state = Game(me, Seat("B"));
		state.DrawPile.Add(Inst("distance-25", 1));
		JourneyRulebook.SyncCounts(state);

		var drawn = JourneyRulebook.Draw(state, "A");
		Assert.True(drawn.Ok);
		Assert.Equal("distance-25#1", drawn.Card!.InstanceId);
		Assert.True(state.HasDrawn);
		Assert.Equal(0, state.DrawCount);
		Assert.Equal(1, me.Members[0].HandCount);

		Assert.Equal("game.journey_deck_empty", JourneyRulebook.Draw(state, "A").ReasonKey);
	}

	[Fact]
	public void Discard_moves_the_card_to_the_face_up_pile()
	{
		var me = Seat("A");
		me.Members[0].Hand.Add(Inst("go"));
		var state = Game(me, Seat("B"));

		var result = JourneyRulebook.Discard(state, "A", "go#0", Cat);

		Assert.True(result.Ok);
		Assert.Equal("go", result.Card!.Id);
		Assert.Empty(me.Members[0].Hand);
		Assert.Equal(new[] { "go#0" }, state.DiscardPile.Select(c => c.InstanceId));
	}

	[Fact]
	public void The_hand_also_ends_when_pile_and_hands_are_exhausted()
	{
		var state = Game(Seat("A"), Seat("B"));
		Assert.True(JourneyRulebook.HandOver(state, Rules())); // nothing left anywhere

		state.Seats[0].Members[0].Hand.Add(Inst("distance-25"));
		Assert.False(JourneyRulebook.HandOver(state, Rules()));
	}

	// ── Scoring + match ───────────────────────────────────────────────────────

	[Fact]
	public void The_official_scoring_table_adds_up_for_a_perfect_trip()
	{
		var winner = Seat("A");
		winner.Km = 1000;
		winner.Immunities.AddRange(new[] { "priority", "solid" }); // ALL the catalog's immunities
		winner.CoupFourres = 1;
		winner.PremiumPlays = 0; // safe trip
		var shutOut = Seat("B"); // 0 km -> capot
		var state = Game(winner, shutOut); // empty pile -> deck-exhausted bonus

		var scores = JourneyRulebook.ScoreHand(state, Cat, Rules());

		var a = scores.First(s => s.PlayerId == "A");
		Assert.Equal(1000, a.Km);
		Assert.Equal(200, a.ImmunityPoints);
		Assert.Equal(300, a.AllImmunitiesBonus);
		Assert.Equal(300, a.CoupFourrePoints);
		Assert.Equal(400, a.TripCompleteBonus);
		Assert.Equal(300, a.SafeTripBonus);
		Assert.Equal(300, a.DeckExhaustedBonus);
		Assert.Equal(500, a.CapotBonus);
		Assert.Equal(3300, a.Total);
		Assert.Equal(3300, a.MatchScore);
		Assert.Equal(3300, winner.Score);

		var b = scores.First(s => s.PlayerId == "B");
		Assert.Equal(0, b.Total);
	}

	[Fact]
	public void An_incomplete_trip_scores_kilometres_without_the_completion_bonuses()
	{
		var seat = Seat("A");
		seat.Km = 425;
		seat.PremiumPlays = 2;
		var state = Game(seat, Seat("B"));

		var score = JourneyRulebook.ScoreHand(state, Cat, Rules()).First(s => s.PlayerId == "A");

		Assert.Equal(425, score.Total); // km only: no trip/safe/exhausted/capot bonuses
	}

	[Fact]
	public void The_next_hand_resets_the_table_but_carries_the_match_scores()
	{
		var state = JourneyRulebook.CreateInitialState(Solo("A", "B"), Deck(), Rules(), new ScriptedRandomSource());
		state.Seats[0].Km = 1000;
		JourneyRulebook.ScoreHand(state, Cat, Rules());
		var scoreA = state.Seats[0].Score;
		Assert.True(scoreA > 0);

		var next = JourneyRulebook.StartNextHand(state, Deck(), Rules(), new ScriptedRandomSource());

		Assert.Equal(2, next.Round);
		Assert.Equal(scoreA, next.Seats[0].Score);
		Assert.Equal(0, next.Seats[0].Km);
		Assert.Equal(new[] { "stop" }, next.Seats[0].Hazards);
		Assert.All(next.Seats, s => Assert.Equal(6, s.Members[0].Hand.Count));
		Assert.Empty(next.DiscardPile);
	}

	[Fact]
	public void The_match_ends_at_the_target_score_or_after_one_hand_when_target_is_zero()
	{
		var state = Game(Seat("A"), Seat("B"));
		state.Seats[0].Score = 4999;
		Assert.False(JourneyRulebook.MatchOver(state, Rules()));

		state.Seats[0].Score = 5000;
		Assert.True(JourneyRulebook.MatchOver(state, Rules()));

		state.Seats[0].Score = 0;
		Assert.True(JourneyRulebook.MatchOver(state, Rules(target: 0))); // single-hand game
	}
}
