using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Pure rules of the assembly family: slot lifecycle (afflict → destroy,
/// shield → lock), colour matching with wilds, the five specials, the pass, the refill
/// that reshuffles the face-down discards, and the win over functional distinct colours.
/// </summary>
public class AssemblyRulebookTests
{
	private static readonly List<AssemblyCardDef> Deck = new()
	{
		new() { Id = "p-red", Type = "piece", Color = "red", Count = 5, NameKey = "c.p-red" },
		new() { Id = "p-green", Type = "piece", Color = "green", Count = 5, NameKey = "c.p-green" },
		new() { Id = "p-blue", Type = "piece", Color = "blue", Count = 5, NameKey = "c.p-blue" },
		new() { Id = "p-yellow", Type = "piece", Color = "yellow", Count = 5, NameKey = "c.p-yellow" },
		new() { Id = "p-wild", Type = "piece", Color = "wild", Count = 1, NameKey = "c.p-wild" },
		new() { Id = "a-red", Type = "attack", Color = "red", Count = 4, NameKey = "c.a-red" },
		new() { Id = "a-green", Type = "attack", Color = "green", Count = 4, NameKey = "c.a-green" },
		new() { Id = "a-wild", Type = "attack", Color = "wild", Count = 1, NameKey = "c.a-wild" },
		new() { Id = "r-red", Type = "remedy", Color = "red", Count = 4, NameKey = "c.r-red" },
		new() { Id = "r-green", Type = "remedy", Color = "green", Count = 4, NameKey = "c.r-green" },
		new() { Id = "r-wild", Type = "remedy", Color = "wild", Count = 2, NameKey = "c.r-wild" },
		new() { Id = "s-swap", Type = "special", SpecialKind = "swapPiece", Count = 3, NameKey = "c.s-swap" },
		new() { Id = "s-steal", Type = "special", SpecialKind = "stealPiece", Count = 3, NameKey = "c.s-steal" },
		new() { Id = "s-plague", Type = "special", SpecialKind = "plague", Count = 2, NameKey = "c.s-plague" },
		new() { Id = "s-scrap", Type = "special", SpecialKind = "scrapHands", Count = 1, NameKey = "c.s-scrap" },
		new() { Id = "s-fullswap", Type = "special", SpecialKind = "fullSwap", Count = 1, NameKey = "c.s-fullswap" },
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

	private static AssemblySlot Slot(string color, string[]? afflictions = null, string[]? shields = null)
		=> new()
		{
			Color = color,
			Piece = Inst($"p-{(color == "wild" ? "wild" : color)}", 9),
			Afflictions = (afflictions ?? Array.Empty<string>()).Select(a => Inst(a, 1)).ToList(),
			Shields = (shields ?? Array.Empty<string>()).Select(s => Inst(s, 2)).ToList(),
		};

	private static AssemblyState State(params AssemblySeatState[] seats)
		=> new() { Seats = seats.ToList() };

	// ── Construction ──────────────────────────────────────────────────────────

	[Fact]
	public void CreateInitialState_deals_opening_hands_and_syncs_counts()
	{
		var state = AssemblyRulebook.CreateInitialState(
			new[] { "a", "b" }, Deck, Rules, new ScriptedRandomSource());

		Assert.All(state.Seats, s => Assert.Equal(3, s.Hand.Count));
		Assert.All(state.Seats, s => Assert.Equal(3, s.HandCount));
		var total = Deck.Sum(c => c.Count);
		Assert.Equal(total - 6, state.DrawCount);
		Assert.Equal(0, state.DiscardCount);
	}

	// ── Pieces ────────────────────────────────────────────────────────────────

	[Fact]
	public void Playing_a_piece_adds_a_slot_and_a_second_of_the_same_colour_is_refused()
	{
		var a = Seat("a", hand: new[] { "p-red", "p-red" });
		var state = State(a, Seat("b"));

		var first = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, null, null, null, Rules, Catalog);
		Assert.True(first.Ok);
		Assert.Single(a.Slots);
		Assert.Equal("red", a.Slots[0].Color);

		var second = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, null, null, null, Rules, Catalog);
		Assert.False(second.Ok);
		Assert.Equal("game.assembly_color_taken", second.ReasonKey);
	}

	// ── Attacks: the slot lifecycle ───────────────────────────────────────────

	[Fact]
	public void An_attack_afflicts_a_healthy_slot_and_a_second_one_destroys_it()
	{
		var a = Seat("a", hand: new[] { "a-red", "a-red" });
		var b = Seat("b", slots: Slot("red"));
		var state = State(a, b);

		var first = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, "b", "red", null, Rules, Catalog);
		Assert.True(first.Ok);
		Assert.Single(b.Slots[0].Afflictions);
		// The result NAMES the outcome and the hit piece, for the "how did it end up" voice.
		Assert.Equal("afflicted", first.AttackOutcome);
		Assert.Equal("c.p-red", first.AttackedPieceKey);

		var second = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, "b", "red", null, Rules, Catalog);
		Assert.True(second.Ok);
		Assert.Empty(b.Slots); // piece destroyed
		Assert.Equal("destroyed", second.AttackOutcome);
		// Piece + both attacks went to the (face-down) discards.
		Assert.Equal(3, state.DiscardPile.Count);
	}

	[Fact]
	public void An_attack_on_a_shielded_slot_burns_the_shield_instead()
	{
		var a = Seat("a", hand: new[] { "a-red" });
		var b = Seat("b", slots: Slot("red", shields: new[] { "r-red" }));
		var state = State(a, b);

		var result = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, "b", "red", null, Rules, Catalog);

		Assert.True(result.Ok);
		Assert.Empty(b.Slots[0].Shields);
		Assert.Empty(b.Slots[0].Afflictions); // the piece survived untouched
		Assert.Equal("shieldBurned", result.AttackOutcome);
		Assert.Equal(2, state.DiscardPile.Count); // shield + attack
	}

	[Fact]
	public void A_locked_slot_is_untouchable_and_colours_must_match()
	{
		var a = Seat("a", hand: new[] { "a-red", "a-green", "a-wild" });
		var b = Seat("b", slots: new[]
		{
			Slot("red", shields: new[] { "r-red", "r-red" }), // locked
            Slot("green"),
		});
		var state = State(a, b);

		var locked = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, "b", "red", null, Rules, Catalog);
		Assert.Equal("game.assembly_slot_locked", locked.ReasonKey);

		var mismatch = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, "b", "green", null, Rules, Catalog);
		Assert.Equal("game.assembly_color_mismatch", mismatch.ReasonKey);

		// The wild attack hits any (non-locked) colour.
		var wild = AssemblyRulebook.Play(state, "a", a.Hand[2].InstanceId, "b", "green", null, Rules, Catalog);
		Assert.True(wild.Ok);
	}

	[Fact]
	public void Attacking_yourself_or_nobody_is_refused()
	{
		var a = Seat("a", hand: new[] { "a-red" }, slots: Slot("red"));
		var state = State(a, Seat("b"));

		Assert.Equal("game.assembly_needs_target",
			AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, "a", "red", null, Rules, Catalog).ReasonKey);
		Assert.Equal("game.assembly_needs_target",
			AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, null, "red", null, Rules, Catalog).ReasonKey);
	}

	// ── Remedies: cure, shield, lock ──────────────────────────────────────────

	[Fact]
	public void A_remedy_cures_an_affliction_first_then_shields_then_locks()
	{
		var a = Seat("a", hand: new[] { "r-red", "r-red", "r-red", "r-red" },
			slots: Slot("red", afflictions: new[] { "a-red" }));
		var state = State(a, Seat("b"));
		var slot = a.Slots[0];

		var cured = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, null, "red", null, Rules, Catalog);
		Assert.True(cured.Ok);
		Assert.Empty(slot.Afflictions); // cured (remedy + affliction burned)
		Assert.Equal(2, state.DiscardPile.Count);
		// The result NAMES what the medicine did and to which piece, for the outcome voice
		// ("¡Inmunizas tu estómago!" — the plain "plays a remedy" line said nothing).
		Assert.Equal("cured", cured.RemedyOutcome);
		Assert.Equal("c.p-red", cured.RemediedPieceKey);

		var shielded = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, null, "red", null, Rules, Catalog);
		Assert.True(shielded.Ok);
		Assert.Single(slot.Shields); // shielded
		Assert.Equal("shielded", shielded.RemedyOutcome);

		var locked = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, null, "red", null, Rules, Catalog);
		Assert.True(locked.Ok);
		Assert.True(AssemblyRulebook.IsLocked(slot)); // locked
		Assert.Equal("locked", locked.RemedyOutcome);

		var again = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, null, "red", null, Rules, Catalog);
		Assert.Equal("game.assembly_already_locked", again.ReasonKey);
	}

	// ── The win ───────────────────────────────────────────────────────────────

	[Fact]
	public void Four_functional_distinct_colours_win_and_a_wild_fills_a_missing_one()
	{
		var seat = Seat("a", slots: new[] { Slot("red"), Slot("green"), Slot("blue") });
		Assert.False(AssemblyRulebook.HasWon(seat, Rules));

		seat.Slots.Add(Slot("wild"));
		Assert.True(AssemblyRulebook.HasWon(seat, Rules));
	}

	[Fact]
	public void An_afflicted_slot_does_not_count_toward_the_win()
	{
		var seat = Seat("a", slots: new[]
		{
			Slot("red"), Slot("green"), Slot("blue"),
			Slot("yellow", afflictions: new[] { "a-red" }),
		});
		Assert.False(AssemblyRulebook.HasWon(seat, Rules));
	}

	[Fact]
	public void Playing_the_winning_piece_reports_the_win()
	{
		var a = Seat("a", hand: new[] { "p-yellow" },
			slots: new[] { Slot("red"), Slot("green"), Slot("blue") });
		var state = State(a, Seat("b"));

		var result = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, null, null, null, Rules, Catalog);

		Assert.True(result.Ok);
		Assert.True(result.Won);
	}

	// ── Specials ──────────────────────────────────────────────────────────────

	[Fact]
	public void SwapPiece_exchanges_two_slots_with_their_states()
	{
		var a = Seat("a", hand: new[] { "s-swap" }, slots: Slot("red", afflictions: new[] { "a-red" }));
		var b = Seat("b", slots: Slot("green", shields: new[] { "r-green" }));
		var state = State(a, b);

		var result = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, "b", "green", "red", Rules, Catalog);

		Assert.True(result.Ok);
		Assert.Equal("green", a.Slots[0].Color);
		Assert.Single(a.Slots[0].Shields);      // their shield travelled with the piece
		Assert.Equal("red", b.Slots[0].Color);
		Assert.Single(b.Slots[0].Afflictions);  // my affliction travelled too
												// The result NAMES both moved pieces: the client's picker auto-resolves a
												// single-option give step, so the voice must tell what actually changed hands.
		Assert.Equal("c.p-green", result.TakenPieceKey);
		Assert.Equal("c.p-red", result.GivenPieceKey);
	}

	[Fact]
	public void SwapPiece_refuses_locked_slots_and_colour_duplicates()
	{
		var a = Seat("a", hand: new[] { "s-swap", "s-swap" },
			slots: new[] { Slot("red"), Slot("green") });
		var b = Seat("b", slots: new[] { Slot("green", shields: new[] { "r-green", "r-green" }), Slot("red") });
		var state = State(a, b);

		// Their green is locked.
		Assert.Equal("game.assembly_slot_locked",
			AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, "b", "green", "red", Rules, Catalog).ReasonKey);
		// Taking their red while keeping my own red would duplicate it.
		Assert.Equal("game.assembly_color_taken",
			AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, "b", "red", "green", Rules, Catalog).ReasonKey);
	}

	[Fact]
	public void StealPiece_moves_a_rival_slot_into_my_free_colour()
	{
		var a = Seat("a", hand: new[] { "s-steal" }, slots: Slot("red"));
		var b = Seat("b", slots: Slot("green", shields: new[] { "r-green" }));
		var state = State(a, b);

		var result = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, "b", "green", null, Rules, Catalog);

		Assert.True(result.Ok);
		Assert.Equal(2, a.Slots.Count);
		Assert.Empty(b.Slots);
		Assert.Single(a.Slots.First(s => s.Color == "green").Shields); // state carried
																	   // The result names the taken piece (nothing is given back in a steal).
		Assert.Equal("c.p-green", result.TakenPieceKey);
		Assert.Null(result.GivenPieceKey);
	}

	[Fact]
	public void Plague_moves_each_of_my_afflictions_onto_clean_matching_rival_slots()
	{
		var a = Seat("a", hand: new[] { "s-plague" }, slots: new[]
		{
			Slot("red", afflictions: new[] { "a-red" }),
			Slot("green", afflictions: new[] { "a-green" }),
		});
		var b = Seat("b", slots: new[]
		{
			Slot("red"),                                  // clean: takes the red affliction
            Slot("green", shields: new[] { "r-green" }),  // shielded: NOT clean, spared
        });
		var state = State(a, b);

		var result = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, null, null, null, Rules, Catalog);

		Assert.True(result.Ok);
		Assert.Empty(a.Slots[0].Afflictions);                 // red left me…
		Assert.Single(b.Slots[0].Afflictions);                // …and landed on their clean red
		Assert.Single(a.Slots[1].Afflictions);                // green had no clean target: stays
		Assert.Empty(b.Slots[1].Afflictions);
	}

	[Fact]
	public void Plague_with_nothing_to_spread_is_refused()
	{
		var a = Seat("a", hand: new[] { "s-plague" }, slots: Slot("red"));
		var state = State(a, Seat("b", slots: Slot("green")));

		Assert.Equal("game.assembly_nothing_to_spread",
			AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, null, null, null, Rules, Catalog).ReasonKey);
	}

	[Fact]
	public void ScrapHands_empties_every_rival_hand_into_the_discards()
	{
		var a = Seat("a", hand: new[] { "s-scrap" });
		var b = Seat("b", hand: new[] { "p-red", "p-green" });
		var c = Seat("c", hand: new[] { "a-red" });
		var state = State(a, b, c);

		var result = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, null, null, null, Rules, Catalog);

		Assert.True(result.Ok);
		Assert.Empty(b.Hand);
		Assert.Empty(c.Hand);
		Assert.Equal(4, state.DiscardPile.Count); // 3 scrapped + the special itself
	}

	[Fact]
	public void FullSwap_exchanges_whole_racks_locked_slots_included()
	{
		var a = Seat("a", hand: new[] { "s-fullswap" }, slots: Slot("red"));
		var b = Seat("b", slots: new[]
		{
			Slot("green", shields: new[] { "r-green", "r-green" }), // locked travels too
            Slot("blue"),
		});
		var state = State(a, b);

		var result = AssemblyRulebook.Play(state, "a", a.Hand[0].InstanceId, "b", null, null, Rules, Catalog);

		Assert.True(result.Ok);
		Assert.Equal(2, a.Slots.Count);
		Assert.Single(b.Slots);
		Assert.Equal("red", b.Slots[0].Color);
		Assert.Contains(a.Slots, s => AssemblyRulebook.IsLocked(s));
	}

	// ── Discard / pass ────────────────────────────────────────────────────────

	[Fact]
	public void Discarding_up_to_the_limit_works_and_more_is_refused()
	{
		var a = Seat("a", hand: new[] { "p-red", "p-green", "p-blue", "a-red" });
		var state = State(a, Seat("b"));

		var tooMany = AssemblyRulebook.Discard(state, "a", a.Hand.Take(4).Select(c => c.InstanceId).ToList(), Rules);
		Assert.Equal("game.assembly_discard_too_many", tooMany.ReasonKey);

		var ok = AssemblyRulebook.Discard(state, "a", a.Hand.Take(3).Select(c => c.InstanceId).ToList(), Rules);
		Assert.True(ok.Ok);
		Assert.Equal(3, ok.Count);
		Assert.Single(a.Hand);
		Assert.Equal(3, state.DiscardCount);
	}

	[Fact]
	public void Passing_with_cards_in_hand_is_refused_but_legal_when_empty()
	{
		var a = Seat("a", hand: new[] { "p-red" });
		var state = State(a, Seat("b"));

		Assert.Equal("game.assembly_must_act",
			AssemblyRulebook.Discard(state, "a", new List<string>(), Rules).ReasonKey);

		a.Hand.Clear();
		var pass = AssemblyRulebook.Discard(state, "a", new List<string>(), Rules);
		Assert.True(pass.Ok);
		Assert.Equal(0, pass.Count);
	}

	// ── Refill ────────────────────────────────────────────────────────────────

	[Fact]
	public void Refill_draws_back_to_hand_size()
	{
		var state = AssemblyRulebook.CreateInitialState(new[] { "a", "b" }, Deck, Rules, new ScriptedRandomSource());
		var a = AssemblyRulebook.SeatOf(state, "a");
		AssemblyRulebook.Discard(state, "a", a.Hand.Take(2).Select(c => c.InstanceId).ToList(), Rules);

		var drawn = AssemblyRulebook.RefillHand(state, "a", Rules, new ScriptedRandomSource());

		Assert.Equal(2, drawn.Count);
		Assert.Equal(3, a.Hand.Count);
	}

	[Fact]
	public void Refill_reshuffles_the_facedown_discards_when_the_pile_dries()
	{
		var a = Seat("a");
		var state = State(a, Seat("b"));
		state.DiscardPile.AddRange(new[] { Inst("p-red"), Inst("p-green"), Inst("p-blue"), Inst("p-yellow") });
		AssemblyRulebook.SyncCounts(state);

		var drawn = AssemblyRulebook.RefillHand(state, "a", Rules, new ScriptedRandomSource());

		Assert.Equal(3, drawn.Count);
		Assert.Equal(3, a.Hand.Count);
		Assert.Equal(0, state.DiscardCount); // discards became the new pile…
		Assert.Equal(1, state.DrawCount);    // …with one card left after the refill
	}
}
