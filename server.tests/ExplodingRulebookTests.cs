using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Pure-rules tests for the exploding family: the opening deal
/// (a guaranteed defuse per hand, no bomb in a hand, players−1 bombs planted), the ordered
/// draw-pile primitives (draw / peek / tuck-at-depth / shuffle), cat-pair matching, the
/// Nope-stack parity, the fallen-seat turn walk, the sole-survivor win and the retirement fold.
/// The identity shuffle (ScriptedRandomSource) makes the deal deterministic.
/// </summary>
public class ExplodingRulebookTests
{
	private static List<ExplodingCardDef> Deck() => new()
	{
		new() { Id = "bomb", Type = "bomb", Count = 3, NameKey = "c.bomb" },
		new() { Id = "defuse", Type = "defuse", Count = 4, NameKey = "c.defuse" },
		new() { Id = "skip", Type = "skip", Count = 2, NameKey = "c.skip" },
		new() { Id = "attack", Type = "attack", Count = 2, NameKey = "c.attack" },
		new() { Id = "see", Type = "seeFuture", Count = 2, NameKey = "c.see" },
		new() { Id = "shuffle", Type = "shuffle", Count = 1, NameKey = "c.shuffle" },
		new() { Id = "favor", Type = "favor", Count = 2, NameKey = "c.favor" },
		new() { Id = "nope", Type = "nope", Count = 3, NameKey = "c.nope" },
		new() { Id = "catA", Type = "cat", Count = 4, NameKey = "c.catA" },
		new() { Id = "catB", Type = "cat", Count = 4, NameKey = "c.catB" },
	};

	private static ExplodingRulesConfig Rules(int handSize = 1) =>
		new() { HandSize = handSize, DefusesPerPlayer = 1 };

	private static ExplodingCardInstance Inst(string cardId, int copy = 0) =>
		new() { InstanceId = $"{cardId}#{copy}", CardId = cardId };

	private static string TypeOf(ExplodingState s, ExplodingCardInstance i, List<ExplodingCardDef> deck)
		=> ExplodingRulebook.Catalog(deck)[i.CardId].Type;

	// ── The deal ────────────────────────────────────────────────────────────────

	[Fact]
	public void Deal_gives_every_hand_a_defuse_and_no_bomb()
	{
		var deck = Deck();
		var state = ExplodingRulebook.CreateInitialState(
			new[] { "a", "b", "c" }, deck, Rules(handSize: 1), new ScriptedRandomSource());

		foreach (var seat in state.Seats)
		{
			Assert.Equal(2, seat.Hand.Count); // one guaranteed defuse + HandSize (1) ordinary
			Assert.Single(seat.Hand, i => TypeOf(state, i, deck) == "defuse");
			Assert.DoesNotContain(seat.Hand, i => TypeOf(state, i, deck) == "bomb");
		}
	}

	[Fact]
	public void Deal_plants_exactly_players_minus_one_bombs_in_the_draw_pile()
	{
		var deck = Deck();
		var catalog = ExplodingRulebook.Catalog(deck);
		var state = ExplodingRulebook.CreateInitialState(
			new[] { "a", "b", "c" }, deck, Rules(handSize: 1), new ScriptedRandomSource());

		var bombsInPile = state.DrawPile.Count(i => catalog[i.CardId].Type == "bomb");
		Assert.Equal(2, bombsInPile); // 3 players → 2 bombs; everyone explodes but one
		Assert.Equal(state.DrawPile.Count, state.DrawCount); // counts stay in sync
	}

	// ── The ordered draw pile ─────────────────────────────────────────────────────

	[Fact]
	public void DrawTop_takes_the_last_card_and_shrinks_the_pile()
	{
		var state = new ExplodingState();
		state.DrawPile.AddRange(new[] { Inst("a"), Inst("b"), Inst("c") }); // top = c (last)

		var drawn = ExplodingRulebook.DrawTop(state);

		Assert.Equal("c#0", drawn!.InstanceId);
		Assert.Equal(2, state.DrawPile.Count);
		Assert.Equal(2, state.DrawCount);
		Assert.Null(ExplodingRulebook.DrawTop(new ExplodingState())); // empty → null
	}

	[Fact]
	public void PeekTop_returns_the_next_cards_in_draw_order()
	{
		var state = new ExplodingState();
		state.DrawPile.AddRange(new[] { Inst("a"), Inst("b"), Inst("c") }); // next to draw: c, then b

		var peek = ExplodingRulebook.PeekTop(state, 2);

		Assert.Equal(new[] { "c#0", "b#0" }, peek.Select(i => i.InstanceId));
		Assert.Equal(3, state.DrawPile.Count); // a peek does not remove anything
		Assert.Equal(3, ExplodingRulebook.PeekTop(state, 9).Count); // clamps to the pile size
	}

	[Fact]
	public void InsertBomb_places_the_bomb_at_the_requested_depth()
	{
		var bomb = Inst("bomb");

		// cardsAbove = 0 → the very top → drawn next.
		var top = new ExplodingState();
		top.DrawPile.AddRange(new[] { Inst("a"), Inst("b"), Inst("c") });
		ExplodingRulebook.InsertBomb(top, bomb, 0);
		Assert.Equal("bomb#0", ExplodingRulebook.DrawTop(top)!.InstanceId);

		// cardsAbove = Count → the bottom → three cards drawn before it.
		var bottom = new ExplodingState();
		bottom.DrawPile.AddRange(new[] { Inst("a"), Inst("b"), Inst("c") });
		ExplodingRulebook.InsertBomb(bottom, bomb, 3);
		Assert.Equal(0, bottom.DrawPile.IndexOf(bomb)); // first element = last drawn

		// cardsAbove = 1 → one card drawn before it.
		var mid = new ExplodingState();
		mid.DrawPile.AddRange(new[] { Inst("a"), Inst("b"), Inst("c") });
		ExplodingRulebook.InsertBomb(mid, bomb, 1);
		Assert.Equal("c#0", ExplodingRulebook.DrawTop(mid)!.InstanceId); // c first
		Assert.Equal("bomb#0", ExplodingRulebook.DrawTop(mid)!.InstanceId); // then the bomb

		// Out-of-range depth is clamped, never throws.
		var clamp = new ExplodingState();
		clamp.DrawPile.Add(Inst("a"));
		ExplodingRulebook.InsertBomb(clamp, bomb, 99);
		Assert.Equal(2, clamp.DrawPile.Count);
	}

	// ── Cat pairs ────────────────────────────────────────────────────────────────

	[Fact]
	public void AreCatPair_only_matches_two_distinct_copies_of_the_same_cat()
	{
		var catalog = ExplodingRulebook.Catalog(Deck());

		Assert.True(ExplodingRulebook.AreCatPair(Inst("catA", 0), Inst("catA", 1), catalog));
		Assert.False(ExplodingRulebook.AreCatPair(Inst("catA", 0), Inst("catB", 0), catalog)); // different cats
		Assert.False(ExplodingRulebook.AreCatPair(Inst("catA", 0), Inst("catA", 0), catalog)); // same instance
		Assert.False(ExplodingRulebook.AreCatPair(Inst("skip", 0), Inst("skip", 1), catalog)); // not cats
	}

	// ── The Nope stack ───────────────────────────────────────────────────────────

	[Theory]
	[InlineData(0, false)] // nobody noped → the action stands
	[InlineData(1, true)]  // one nope cancels
	[InlineData(2, false)] // a counter-nope restores it
	[InlineData(3, true)]  // …and so on by parity
	public void NopeCancels_is_odd_parity(int nopes, bool cancelled)
		=> Assert.Equal(cancelled, ExplodingRulebook.NopeCancels(nopes));

	// ── Turn order and the win ─────────────────────────────────────────────────────

	[Fact]
	public void NextPlayer_walks_forward_past_fallen_seats()
	{
		var state = new ExplodingState
		{
			Seats =
			{
				new() { PlayerId = "a" },
				new() { PlayerId = "b", Retired = true },
				new() { PlayerId = "c" },
			},
		};

		Assert.Equal("c", ExplodingRulebook.NextPlayer(state, "a")); // skips the exploded b
		Assert.Equal("a", ExplodingRulebook.NextPlayer(state, "c")); // wraps
	}

	[Fact]
	public void SoleSurvivor_is_the_last_seat_standing()
	{
		var state = new ExplodingState
		{
			Seats = { new() { PlayerId = "a" }, new() { PlayerId = "b" } },
		};
		Assert.Null(ExplodingRulebook.SoleSurvivor(state)); // two still in

		state.Seats[1].Retired = true;
		Assert.Equal("a", ExplodingRulebook.SoleSurvivor(state)!.PlayerId);
	}

	// ── Retirement / elimination ───────────────────────────────────────────────────

	[Fact]
	public void Retire_folds_the_seat_and_discards_its_hand_out_of_play()
	{
		var state = new ExplodingState
		{
			Seats =
			{
				new() { PlayerId = "a", Hand = { Inst("skip"), Inst("nope") } },
				new() { PlayerId = "b" },
			},
			PendingAction = new PendingExplodingAction { ActorId = "a", CardId = "skip" },
		};

		ExplodingRulebook.Retire(state, "a");

		var a = ExplodingRulebook.SeatOf(state, "a");
		Assert.True(a.Retired);
		Assert.Empty(a.Hand);
		Assert.Equal(2, state.DiscardPile.Count); // the hand left play (EK never reshuffles)
		Assert.Equal(2, state.DiscardCount);
		Assert.Null(state.PendingAction); // a pending action they owned is dropped
	}
}
