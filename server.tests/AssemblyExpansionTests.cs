using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// The assembly family's expansion mechanics: RESISTANT attacks that shrug off ordinary
/// treatment, POTENT remedies that lift them and seal a piece on their own, INERT pieces
/// nothing sticks to, the exile special that takes a card out of the game for good, the two
/// turn-extending specials (doubleAct, handSwap) and the two house rules (duel goal,
/// attrition cures). A deck that ships none of these plays exactly as before — every trait
/// here is opt-in card data, which <see cref="AssemblyRulebookTests"/> covers.
/// </summary>
public class AssemblyExpansionTests
{
	private static readonly List<AssemblyCardDef> Deck = new()
	{
		new() { Id = "p-red", Type = "piece", Color = "red", Count = 5, NameKey = "c.p-red" },
		new() { Id = "p-green", Type = "piece", Color = "green", Count = 5, NameKey = "c.p-green" },
		new() { Id = "p-blue", Type = "piece", Color = "blue", Count = 5, NameKey = "c.p-blue" },
		new() { Id = "p-yellow", Type = "piece", Color = "yellow", Count = 5, NameKey = "c.p-yellow" },
		new() { Id = "p-wild", Type = "piece", Color = "wild", Count = 1, NameKey = "c.p-wild" },
		// The inert piece: its own colour, which no attack or remedy answers.
		new() { Id = "p-grey", Type = "piece", Color = "grey", Count = 1, Inert = true, NameKey = "c.p-grey" },

		new() { Id = "a-red", Type = "attack", Color = "red", Count = 4, NameKey = "c.a-red" },
		new() { Id = "a-green", Type = "attack", Color = "green", Count = 4, NameKey = "c.a-green" },
		new() { Id = "a-wild", Type = "attack", Color = "wild", Count = 1, NameKey = "c.a-wild" },
		new() { Id = "x-red", Type = "attack", Color = "red", Count = 2, Resistant = true, NameKey = "c.x-red" },
		new() { Id = "x-wild", Type = "attack", Color = "wild", Count = 1, Resistant = true, NameKey = "c.x-wild" },

		new() { Id = "r-red", Type = "remedy", Color = "red", Count = 4, NameKey = "c.r-red" },
		new() { Id = "r-green", Type = "remedy", Color = "green", Count = 4, NameKey = "c.r-green" },
		new() { Id = "r-wild", Type = "remedy", Color = "wild", Count = 2, NameKey = "c.r-wild" },
		new() { Id = "e-red", Type = "remedy", Color = "red", Count = 1, Potent = true, NameKey = "c.e-red" },
		new() { Id = "e-wild", Type = "remedy", Color = "wild", Count = 3, Potent = true, NameKey = "c.e-wild" },

		new() { Id = "s-steal", Type = "special", SpecialKind = "stealPiece", Count = 3, NameKey = "c.s-steal" },
		new() { Id = "s-plague", Type = "special", SpecialKind = "plague", Count = 2, NameKey = "c.s-plague" },
		new() { Id = "s-exile", Type = "special", SpecialKind = "exile", Count = 4, NameKey = "c.s-exile" },
		new() { Id = "s-double", Type = "special", SpecialKind = "doubleAct", Count = 2, NameKey = "c.s-double" },
		new() { Id = "s-handswap", Type = "special", SpecialKind = "handSwap", Count = 2, NameKey = "c.s-handswap" },
	};

	private static readonly Dictionary<string, AssemblyCardDef> Catalog = AssemblyRulebook.Catalog(Deck);
	private static readonly AssemblyRulesConfig Rules = new();

	private static AssemblyCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}@{n}", CardId = cardId };

	private static AssemblySeatState Seat(string id, string[]? hand = null, params AssemblySlot[] slots)
		=> new()
		{
			PlayerId = id,
			Hand = (hand ?? Array.Empty<string>()).Select(Inst).ToList(),
			Slots = slots.ToList(),
		};

	private static AssemblySlot Slot(
		string color, string[]? afflictions = null, string[]? shields = null,
		bool inert = false, bool sealedUp = false)
		=> new()
		{
			Color = color,
			Piece = Inst($"p-{color}", 9),
			Inert = inert,
			Sealed = sealedUp,
			Afflictions = (afflictions ?? Array.Empty<string>()).Select(a => Inst(a, 1)).ToList(),
			Shields = (shields ?? Array.Empty<string>()).Select(s => Inst(s, 2)).ToList(),
		};

	private static AssemblyState State(params AssemblySeatState[] seats)
		=> new() { Seats = seats.ToList() };

	/// <summary>Play the first copy of <paramref name="cardId"/> the actor is holding. Reads the
	/// instance id off the hand rather than rebuilding it: <see cref="Seat"/> numbers duplicate
	/// cards by position, so "the second exile" is not the id a naive guess would produce.</summary>
	private static AssemblyRulebook.PlayResult Play(
		AssemblyState state, string actor, string cardId,
		string? targetPlayer = null, string? targetColor = null, string? giveColor = null,
		AssemblyRulesConfig? rules = null)
	{
		var hand = AssemblyRulebook.SeatOf(state, actor).Hand;
		var instanceId = hand.FirstOrDefault(c => c.CardId == cardId)?.InstanceId ?? $"{cardId}@missing";
		return AssemblyRulebook.Play(state, actor, instanceId,
			targetPlayer, targetColor, giveColor, rules ?? Rules, Catalog);
	}

	// ── Resistant attacks ─────────────────────────────────────────────────────

	[Fact]
	public void An_ordinary_remedy_cannot_lift_a_resistant_affliction()
	{
		var a = Seat("a", hand: new[] { "r-red" }, Slot("red", afflictions: new[] { "x-red" }));
		var result = Play(State(a), "a", "r-red", targetColor: "red");

		Assert.False(result.Ok);
		Assert.Equal("game.assembly_affliction_resistant", result.ReasonKey);
	}

	[Fact]
	public void A_potent_remedy_lifts_a_resistant_affliction()
	{
		var a = Seat("a", hand: new[] { "e-red" }, Slot("red", afflictions: new[] { "x-red" }));
		var state = State(a);
		var result = Play(state, "a", "e-red", targetColor: "red");

		Assert.True(result.Ok);
		Assert.Equal("cured", result.RemedyOutcome);
		Assert.Empty(a.Slots[0].Afflictions);
		// Without the attrition rule the lifted attack recirculates through the discards.
		Assert.Equal(2, state.DiscardPile.Count);
		Assert.Empty(state.ExiledPile);
	}

	[Fact]
	public void A_resistant_attack_still_burns_a_shield_and_still_destroys_a_second_time()
	{
		var burn = Seat("b", null, Slot("red", shields: new[] { "r-red" }));
		var a = Seat("a", hand: new[] { "x-red" });
		Play(State(a, burn), "a", "x-red", targetPlayer: "b", targetColor: "red");
		Assert.Empty(burn.Slots[0].Shields);
		Assert.Empty(burn.Slots[0].Afflictions);

		// A resistant attack lands on top of an ORDINARY one to destroy the piece: the two
		// kinds combine in either order, exactly like two ordinary attacks.
		var victim = Seat("b", null, Slot("red", afflictions: new[] { "a-red" }));
		var attacker = Seat("a", hand: new[] { "x-red" });
		var state = State(attacker, victim);
		var result = Play(state, "a", "x-red", targetPlayer: "b", targetColor: "red");

		Assert.Equal("destroyed", result.AttackOutcome);
		Assert.Empty(victim.Slots);
		Assert.Equal(3, state.DiscardPile.Count); // piece + both attacks
	}

	// ── Potent remedies ───────────────────────────────────────────────────────

	[Fact]
	public void A_potent_remedy_seals_a_clean_piece_on_its_own()
	{
		var a = Seat("a", hand: new[] { "e-red" }, Slot("red"));
		var result = Play(State(a), "a", "e-red", targetColor: "red");

		Assert.True(result.Ok);
		Assert.Equal("sealed", result.RemedyOutcome);
		Assert.True(a.Slots[0].Sealed);
		Assert.True(AssemblyRulebook.IsLocked(a.Slots[0]));
		Assert.Single(a.Slots[0].Shields); // ONE card did what two ordinary ones do
	}

	[Fact]
	public void A_potent_remedy_seals_an_already_shielded_piece()
	{
		var a = Seat("a", hand: new[] { "e-red" }, Slot("red", shields: new[] { "r-red" }));
		Play(State(a), "a", "e-red", targetColor: "red");

		Assert.True(a.Slots[0].Sealed);
		Assert.True(AssemblyRulebook.IsLocked(a.Slots[0]));
	}

	[Fact]
	public void A_sealed_piece_is_beyond_every_attack_and_needs_no_more_treatment()
	{
		var victim = Seat("b", null, Slot("red", shields: new[] { "e-red" }, sealedUp: true));
		var attacker = Seat("a", hand: new[] { "x-red", "a-red" });
		var state = State(attacker, victim);

		Assert.Equal("game.assembly_slot_locked",
			Play(state, "a", "x-red", targetPlayer: "b", targetColor: "red").ReasonKey);
		Assert.Equal("game.assembly_slot_locked",
			Play(state, "a", "a-red", targetPlayer: "b", targetColor: "red").ReasonKey);

		var owner = Seat("b", hand: new[] { "r-red" }, Slot("red", shields: new[] { "e-red" }, sealedUp: true));
		Assert.Equal("game.assembly_already_locked",
			Play(State(owner), "b", "r-red", targetColor: "red").ReasonKey);
	}

	// ── Inert pieces ──────────────────────────────────────────────────────────

	[Fact]
	public void Nothing_sticks_to_an_inert_piece_not_even_a_wild_attack_or_remedy()
	{
		var victim = Seat("b", null, Slot("grey", inert: true));
		var attacker = Seat("a", hand: new[] { "a-wild", "x-wild" });
		var state = State(attacker, victim);

		Assert.Equal("game.assembly_piece_inert",
			Play(state, "a", "a-wild", targetPlayer: "b", targetColor: "grey").ReasonKey);
		Assert.Equal("game.assembly_piece_inert",
			Play(state, "a", "x-wild", targetPlayer: "b", targetColor: "grey").ReasonKey);

		var owner = Seat("b", hand: new[] { "r-wild" }, Slot("grey", inert: true));
		Assert.Equal("game.assembly_piece_inert",
			Play(State(owner), "b", "r-wild", targetColor: "grey").ReasonKey);
	}

	[Fact]
	public void An_inert_piece_can_still_be_taken_which_is_the_only_way_to_lose_it()
	{
		var victim = Seat("b", null, Slot("grey", inert: true));
		var thief = Seat("a", hand: new[] { "s-steal" });
		var state = State(thief, victim);
		var result = Play(state, "a", "s-steal", targetPlayer: "b", targetColor: "grey");

		Assert.True(result.Ok);
		Assert.Empty(victim.Slots);
		Assert.Single(thief.Slots);
		Assert.True(thief.Slots[0].Inert); // the trait travels with the slot
	}

	[Fact]
	public void An_inert_piece_is_never_a_plague_destination()
	{
		var carrier = Seat("a", hand: new[] { "s-plague" }, Slot("red", afflictions: new[] { "a-red" }));
		var rival = Seat("b", null, Slot("grey", inert: true));
		var state = State(carrier, rival);

		Assert.Empty(AssemblyRulebook.PlagueMoves(carrier, state, Catalog));
		Assert.Equal("game.assembly_nothing_to_spread",
			Play(state, "a", "s-plague").ReasonKey);
	}

	[Fact]
	public void Placing_an_inert_piece_carries_the_trait_onto_the_slot()
	{
		var a = Seat("a", hand: new[] { "p-grey" });
		Assert.True(Play(State(a), "a", "p-grey").Ok);
		Assert.True(a.Slots[0].Inert);
		Assert.True(AssemblyRulebook.IsFunctional(a.Slots[0]));
	}

	// ── Exile ─────────────────────────────────────────────────────────────────

	[Fact]
	public void Exile_takes_an_affliction_out_of_the_game_rather_than_to_the_discards()
	{
		var a = Seat("a", hand: new[] { "s-exile" });
		var b = Seat("b", null, Slot("red", afflictions: new[] { "x-red" }));
		var state = State(a, b);
		var result = Play(state, "a", "s-exile", targetPlayer: "b", targetColor: "red");

		Assert.True(result.Ok);
		Assert.Empty(b.Slots[0].Afflictions);
		Assert.Single(state.ExiledPile);
		Assert.Equal(1, state.ExiledCount);
		Assert.Equal("c.p-red", result.ExiledPieceKey);
		Assert.Single(state.DiscardPile); // the exile card itself is merely spent
	}

	[Fact]
	public void Exile_may_clear_your_own_rack_and_a_clean_slot_is_refused()
	{
		var a = Seat("a", hand: new[] { "s-exile", "s-exile" },
			Slot("red", afflictions: new[] { "x-red" }), Slot("green"));
		var state = State(a, Seat("b"));

		Assert.True(Play(state, "a", "s-exile", targetPlayer: "a", targetColor: "red").Ok);
		Assert.Equal("game.assembly_nothing_to_exile",
			Play(state, "a", "s-exile", targetPlayer: "a", targetColor: "green").ReasonKey);
	}

	[Fact]
	public void Exiled_cards_never_come_back_through_the_refill_reshuffle()
	{
		var a = Seat("a", hand: new[] { "s-exile" }, Slot("red", afflictions: new[] { "x-red" }));
		var state = State(a);
		Play(state, "a", "s-exile", targetPlayer: "a", targetColor: "red");

		// Draw pile empty: the refill may only reshuffle the DISCARDS, never the exiles.
		var drawn = AssemblyRulebook.RefillHand(state, "a", Rules, new ScriptedRandomSource());

		Assert.Single(state.ExiledPile);
		Assert.DoesNotContain(drawn, c => c.CardId == "x-red");
		Assert.All(state.DrawPile, c => Assert.NotEqual("x-red", c.CardId));
		Assert.All(a.Hand, c => Assert.NotEqual("x-red", c.CardId));
	}

	// ── House rule: attrition ─────────────────────────────────────────────────

	[Fact]
	public void Attrition_sends_an_attack_cured_by_a_potent_remedy_out_of_the_game()
	{
		var rules = Rules with { AttritionCures = true };
		var a = Seat("a", hand: new[] { "e-red" }, Slot("red", afflictions: new[] { "x-red" }));
		var state = State(a);
		Play(state, "a", "e-red", targetColor: "red", rules: rules);

		Assert.Single(state.ExiledPile);
		Assert.Equal("x-red", state.ExiledPile[0].CardId);
		Assert.Single(state.DiscardPile); // only the spent remedy
	}

	[Fact]
	public void Attrition_leaves_ordinary_cures_alone()
	{
		var rules = Rules with { AttritionCures = true };
		var a = Seat("a", hand: new[] { "r-red" }, Slot("red", afflictions: new[] { "a-red" }));
		var state = State(a);
		Play(state, "a", "r-red", targetColor: "red", rules: rules);

		Assert.Empty(state.ExiledPile);
		Assert.Equal(2, state.DiscardPile.Count);
	}

	// ── House rule: the duel goal ─────────────────────────────────────────────

	[Fact]
	public void The_duel_goal_asks_two_players_for_one_more_colour()
	{
		var rules = Rules with { DuelGoal = true };
		var seat = Seat("a", slots: new[] { Slot("red"), Slot("green"), Slot("blue"), Slot("yellow") });

		var duel = State(seat, Seat("b"));
		Assert.Equal(5, AssemblyRulebook.Goal(duel, rules));
		Assert.False(AssemblyRulebook.HasWon(duel, seat, rules));

		seat.Slots.Add(Slot("grey", inert: true));
		Assert.True(AssemblyRulebook.HasWon(duel, seat, rules));
	}

	[Fact]
	public void The_duel_goal_does_not_touch_a_crowded_table_or_a_table_that_left_it_off()
	{
		var seat = Seat("a", slots: new[] { Slot("red"), Slot("green"), Slot("blue"), Slot("yellow") });

		Assert.True(AssemblyRulebook.HasWon(
			State(seat, Seat("b"), Seat("c")), seat, Rules with { DuelGoal = true }));
		Assert.True(AssemblyRulebook.HasWon(State(seat, Seat("b")), seat, Rules));
	}

	// ── Turn-extending specials ───────────────────────────────────────────────

	[Fact]
	public void DoubleAct_buys_the_rest_of_the_hand_and_is_refused_with_nothing_left()
	{
		var a = Seat("a", hand: new[] { "s-double", "p-red", "p-green" });
		var state = State(a, Seat("b"));
		var result = Play(state, "a", "s-double");

		Assert.True(result.Ok);
		Assert.Equal(2, result.ExtraPlays);
		Assert.Equal(2, state.ExtraPlays);

		// Each following card settles one of the owed plays.
		Play(state, "a", "p-red");
		Assert.Equal(1, state.ExtraPlays);

		var alone = Seat("a", hand: new[] { "s-double" });
		Assert.Equal("game.assembly_nothing_left_to_play",
			Play(State(alone, Seat("b")), "a", "s-double").ReasonKey);
	}

	[Fact]
	public void HandSwap_trades_hands_buys_one_play_and_closes_the_discard()
	{
		var a = Seat("a", hand: new[] { "s-handswap", "p-red" });
		var b = Seat("b", hand: new[] { "p-green", "p-blue", "a-red" });
		var state = State(a, b);
		var result = Play(state, "a", "s-handswap", targetPlayer: "b");

		Assert.True(result.Ok);
		Assert.Equal(new[] { "p-green", "p-blue", "a-red" }, a.Hand.Select(c => c.CardId));
		Assert.Equal(new[] { "p-red" }, b.Hand.Select(c => c.CardId));
		Assert.Equal(1, state.ExtraPlays);
		Assert.True(state.DiscardBlocked);

		// The cards are not yours to throw away.
		var discard = AssemblyRulebook.Discard(state, "a", new[] { a.Hand[0].InstanceId }, Rules);
		Assert.False(discard.Ok);
		Assert.Equal("game.assembly_discard_blocked", discard.ReasonKey);
	}

	[Fact]
	public void An_extended_turn_can_always_be_ended_by_passing()
	{
		var a = Seat("a", hand: new[] { "p-red" });
		var state = State(a, Seat("b")) with { };
		state.ExtraPlays = 1;

		// A hand that cannot be spent must still have a way out of the turn.
		var pass = AssemblyRulebook.Discard(state, "a", Array.Empty<string>(), Rules);
		Assert.True(pass.Ok);
		Assert.Equal(0, pass.Count);
	}

	[Fact]
	public void Ending_the_turn_clears_what_that_turn_bought()
	{
		var state = State(Seat("a"));
		state.ExtraPlays = 2;
		state.DiscardBlocked = true;

		AssemblyRulebook.ClearTurnGrants(state);

		Assert.Equal(0, state.ExtraPlays);
		Assert.False(state.DiscardBlocked);
	}

	// ── Legal-play enumeration ────────────────────────────────────────────────

	[Fact]
	public void LegalTargetings_skips_what_the_expansion_forbids()
	{
		var a = Seat("a", hand: new[] { "a-wild" });
		var b = Seat("b", null, Slot("grey", inert: true), Slot("red", shields: new[] { "e-red" }, sealedUp: true),
			Slot("green"));
		var state = State(a, b);

		var targetings = AssemblyRulebook.LegalTargetings(Catalog["a-wild"], a, state, Catalog);

		// The inert and the sealed slots are out; only the plain green one is hittable.
		Assert.Single(targetings);
		Assert.Equal(new AssemblyRulebook.Targeting("b", "green", null), targetings[0]);
	}

	[Fact]
	public void HasAnyLegalPlay_sees_a_hand_that_has_run_out_of_moves()
	{
		// A lone attack against a table whose only piece is inert: nothing to do.
		var a = Seat("a", hand: new[] { "a-red" });
		var b = Seat("b", null, Slot("grey", inert: true));
		Assert.False(AssemblyRulebook.HasAnyLegalPlay(State(a, b), "a", Catalog));

		var withPiece = Seat("a", hand: new[] { "a-red", "p-red" });
		Assert.True(AssemblyRulebook.HasAnyLegalPlay(State(withPiece, b), "a", Catalog));
	}
}
