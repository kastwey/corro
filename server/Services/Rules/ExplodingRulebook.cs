using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Rules;

/// <summary>
/// Pure rules of the exploding game family: the opening deal (a
/// guaranteed Defuse plus a hand each, then players−1 bombs planted into the draw pile), the
/// ordered draw-pile primitives that are the heart of the genre (draw the top, peek the top,
/// tuck a defused bomb back at a chosen depth, shuffle), cat-pair matching, the Nope-stack
/// parity, the direction-less turn order that skips fallen seats, the sole-survivor win check
/// and the retirement fold. No I/O, no announcements, no clock — the flow layer (the handlers)
/// drives these, owns the voice, and owns the real-time Nope window's wall-clock. Randomness is
/// injected (the E2E scripted source shuffles as the identity, so a deal is predictable).
/// </summary>
public static class ExplodingRulebook
{
	// ── Catalog helpers ───────────────────────────────────────────────────────

	/// <summary>Index the deck catalog by card id (the state stores instances of ids).</summary>
	public static Dictionary<string, ExplodingCardDef> Catalog(IEnumerable<ExplodingCardDef> deck)
		=> deck.ToDictionary(c => c.Id);

	public static ExplodingSeatState SeatOf(ExplodingState state, string playerId)
		=> state.Seats.First(s => s.PlayerId == playerId);

	/// <summary>The seats still in the game, in seat order.</summary>
	public static List<ExplodingSeatState> ActiveSeats(ExplodingState state)
		=> state.Seats.Where(s => !s.Retired).ToList();

	/// <summary>Keep the projected counts (all a rival ever sees) in sync with the piles.</summary>
	public static void SyncCounts(ExplodingState state)
	{
		state.DrawCount = state.DrawPile.Count;
		state.DiscardCount = state.DiscardPile.Count;
		foreach (var seat in state.Seats)
		{
			seat.HandCount = seat.Hand.Count;
		}
	}

	public static bool IsBomb(ExplodingCardDef? def) => def?.Type == "bomb";
	public static bool IsDefuse(ExplodingCardDef? def) => def?.Type == "defuse";

	// ── Game construction and the deal ────────────────────────────────────────

	/// <summary>Build the seats and deal the game.</summary>
	public static ExplodingState CreateInitialState(
		IEnumerable<string> playerIds,
		IReadOnlyList<ExplodingCardDef> deck,
		ExplodingRulesConfig rules,
		IRandomSource random)
	{
		var state = new ExplodingState
		{
			Seats = playerIds.Select(id => new ExplodingSeatState { PlayerId = id }).ToList(),
		};
		DealGame(state, deck, rules, random);
		return state;
	}

	/// <summary>
	/// Deal the opening setup, exactly as the boxed game does:
	/// (1) a guaranteed Defuse (or <see cref="ExplodingRulesConfig.DefusesPerPlayer"/>) into
	///     every hand — bombs are NEVER in an opening hand;
	/// (2) <see cref="ExplodingRulesConfig.HandSize"/> ordinary cards each from a shuffled rest;
	/// (3) the draw pile = the undealt rest + the undealt Defuses + exactly (activeSeats − 1)
	///     bombs, all shuffled together. Planting one fewer bomb than players is what makes the
	///     genre press-your-luck: everyone eventually explodes but one.
	/// </summary>
	public static void DealGame(
		ExplodingState state,
		IReadOnlyList<ExplodingCardDef> deck,
		ExplodingRulesConfig rules,
		IRandomSource random)
	{
		var bombs = new List<ExplodingCardInstance>();
		var defuses = new List<ExplodingCardInstance>();
		var others = new List<ExplodingCardInstance>();
		foreach (var def in deck)
		{
			for (var copy = 0; copy < Math.Max(1, def.Count); copy++)
			{
				var inst = new ExplodingCardInstance { InstanceId = $"{def.Id}#{copy}", CardId = def.Id };
				(def.Type switch { "bomb" => bombs, "defuse" => defuses, _ => others }).Add(inst);
			}
		}

		foreach (var seat in state.Seats)
		{
			seat.Hand.Clear();
		}

		state.DrawPile.Clear();
		state.DiscardPile.Clear();
		state.DrawsOwed = 1;
		state.PendingAction = null;

		var seats = ActiveSeats(state);

		var defusePool = new Queue<ExplodingCardInstance>(defuses);
		foreach (var seat in seats)
		{
			for (var n = 0; n < rules.DefusesPerPlayer && defusePool.Count > 0; n++)
			{
				seat.Hand.Add(defusePool.Dequeue());
			}
		}

		var deal = new Queue<ExplodingCardInstance>(random.Shuffle(others));
		for (var n = 0; n < rules.HandSize; n++)
		{
			foreach (var seat in seats)
			{
				if (deal.Count > 0)
				{
					seat.Hand.Add(deal.Dequeue());
				}
			}
		}

		var pile = new List<ExplodingCardInstance>();
		pile.AddRange(deal);        // undealt ordinary cards
		pile.AddRange(defusePool);  // undealt defuses
		pile.AddRange(bombs.Take(Math.Max(0, seats.Count - 1)));
		state.DrawPile.AddRange(random.Shuffle(pile));

		SyncCounts(state);
	}

	// ── The ordered draw pile (the heart of the genre) ─────────────────────────

	/// <summary>Draw the top card off the pile (top = last), or null when it is empty. The
	/// caller decides what a bomb means; the rulebook just hands the card over.</summary>
	public static ExplodingCardInstance? DrawTop(ExplodingState state)
	{
		if (state.DrawPile.Count == 0)
		{
			return null;
		}

		var card = state.DrawPile[^1];
		state.DrawPile.RemoveAt(state.DrawPile.Count - 1);
		SyncCounts(state);
		return card;
	}

	/// <summary>The top <paramref name="count"/> cards without removing them, in DRAW order
	/// (the very next card first). Fewer when the pile is shorter. This is what See the Future
	/// shows its player.</summary>
	public static IReadOnlyList<ExplodingCardInstance> PeekTop(ExplodingState state, int count)
	{
		var take = Math.Min(Math.Max(0, count), state.DrawPile.Count);
		var top = new List<ExplodingCardInstance>(take);
		for (var i = 0; i < take; i++)
		{
			top.Add(state.DrawPile[state.DrawPile.Count - 1 - i]);
		}

		return top;
	}

	/// <summary>
	/// Tuck a (defused) bomb back into the draw pile so that exactly <paramref name="cardsAbove"/>
	/// cards will be drawn BEFORE it: 0 = the very top (drawn next), <see cref="List{T}.Count"/>
	/// = the bottom. The value is clamped into range. The pile keeps top-LAST, so this inserts at
	/// index (Count − cardsAbove).
	/// </summary>
	public static void InsertBomb(ExplodingState state, ExplodingCardInstance bomb, int cardsAbove)
	{
		var n = state.DrawPile.Count;
		var depth = Math.Clamp(cardsAbove, 0, n);
		state.DrawPile.Insert(n - depth, bomb);
		SyncCounts(state);
	}

	/// <summary>Shuffle the draw pile, erasing any order a peek or a tuck had revealed.</summary>
	public static void ShuffleDraw(ExplodingState state, IRandomSource random)
	{
		var shuffled = random.Shuffle(state.DrawPile).ToList();
		state.DrawPile.Clear();
		state.DrawPile.AddRange(shuffled);
		SyncCounts(state);
	}

	// ── Cat pairs ──────────────────────────────────────────────────────────────

	/// <summary>Two DISTINCT instances form a stealing pair when they are the SAME cat card
	/// (two copies of one character). Different cats do not pair in the basic game.</summary>
	public static bool AreCatPair(
		ExplodingCardInstance a,
		ExplodingCardInstance b,
		IReadOnlyDictionary<string, ExplodingCardDef> catalog)
		=> a.InstanceId != b.InstanceId
		   && a.CardId == b.CardId
		   && catalog.GetValueOrDefault(a.CardId)?.Type == "cat";

	/// <summary>Move ONE random card from <paramref name="fromId"/>'s hand to
	/// <paramref name="toId"/>'s hand (a cat-pair steal). Returns the stolen instance, or null
	/// when the victim's hand is empty. The index comes from the injected randomness.</summary>
	public static ExplodingCardInstance? StealRandom(
		ExplodingState state, string fromId, string toId, IRandomSource random)
	{
		var from = state.Seats.FirstOrDefault(s => s.PlayerId == fromId);
		var to = state.Seats.FirstOrDefault(s => s.PlayerId == toId);
		if (from == null || to == null || from.Hand.Count == 0)
		{
			return null;
		}

		var index = random.Next(0, from.Hand.Count);
		var card = from.Hand[index];
		from.Hand.RemoveAt(index);
		to.Hand.Add(card);
		SyncCounts(state);
		return card;
	}

	/// <summary>Move a SPECIFIC card from <paramref name="fromId"/> to <paramref name="toId"/>
	/// (a Favor: the giver's own choice). Returns the moved instance, or null if it isn't in the
	/// giver's hand.</summary>
	public static ExplodingCardInstance? GiveCard(
		ExplodingState state, string fromId, string toId, string instanceId)
	{
		var from = state.Seats.FirstOrDefault(s => s.PlayerId == fromId);
		var to = state.Seats.FirstOrDefault(s => s.PlayerId == toId);
		var card = from?.Hand.FirstOrDefault(c => c.InstanceId == instanceId);
		if (from == null || to == null || card == null)
		{
			return null;
		}

		from.Hand.Remove(card);
		to.Hand.Add(card);
		SyncCounts(state);
		return card;
	}

	// ── The Nope stack ─────────────────────────────────────────────────────────

	/// <summary>A stack of Nopes cancels the pending action when it is ODD (1 Nope cancels, a
	/// 2nd restores, a 3rd cancels again…). Zero — nobody Noped — leaves the action standing.</summary>
	public static bool NopeCancels(int nopeCount) => nopeCount % 2 == 1;

	// ── Turn order and the win ──────────────────────────────────────────────────

	/// <summary>
	/// The next seat still in the game after <paramref name="currentId"/>, walking forward past
	/// fallen seats. This family has no direction. The current seat may itself be out
	/// (someone just exploded on their own turn): the walk starts from their chair. Returns
	/// <paramref name="currentId"/> in the degenerate case where nobody else is left.
	/// </summary>
	public static string NextPlayer(ExplodingState state, string currentId)
	{
		var seats = state.Seats;
		var index = seats.FindIndex(s => s.PlayerId == currentId);
		for (var i = 0; i < seats.Count; i++)
		{
			index = (index + 1) % seats.Count;
			if (!seats[index].Retired)
			{
				return seats[index].PlayerId;
			}
		}
		return currentId;
	}

	/// <summary>The single seat left in the game, once everyone else has fallen — the winner.
	/// Null while two or more are still in.</summary>
	public static ExplodingSeatState? SoleSurvivor(ExplodingState state)
	{
		var alive = ActiveSeats(state);
		return alive.Count == 1 ? alive[0] : null;
	}

	// ── Retirement / elimination (the fold) ─────────────────────────────────────

	/// <summary>
	/// Fold a seat that is leaving the game — whether it just exploded or the player abandoned:
	/// the seat is marked out, its whole hand is discarded out of play (the family never
	/// reshuffles — the deck only shrinks), it never takes a turn again and can no longer be
	/// targeted, and any pending action it owned is dropped. The flow layer sets Player.Status
	/// (Eliminated) and checks <see cref="SoleSurvivor"/> for the win.
	/// </summary>
	public static void Retire(ExplodingState state, string playerId)
	{
		var seat = state.Seats.FirstOrDefault(s => s.PlayerId == playerId);
		if (seat == null || seat.Retired)
		{
			return;
		}

		seat.Retired = true;
		state.DiscardPile.AddRange(seat.Hand);
		seat.Hand.Clear();
		if (state.PendingAction?.ActorId == playerId)
		{
			state.PendingAction = null;
		}

		SyncCounts(state);
	}
}
