using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Rules;

/// <summary>
/// Pure rules of the shedding game family: matching (by
/// colour, by number value or by action type), the action effects (skip, reverse,
/// penalty draws, wilds naming the colour in force), the draw-one-and-maybe-play-it
/// pause, the direction-aware turn order that skips retired seats, round scoring (the
/// winner collects the points left in every rival hand) and the fresh redeal. No I/O,
/// no announcements, no transport — the flow layer (SheddingTurnFlow) drives these and
/// owns the voice. Randomness is injected.
/// </summary>
public static class SheddingRulebook
{
	// ── Catalog helpers ───────────────────────────────────────────────────────

	/// <summary>Index the deck catalog by card id (the state stores instances of ids).</summary>
	public static Dictionary<string, SheddingCardDef> Catalog(IEnumerable<SheddingCardDef> deck)
		=> deck.ToDictionary(c => c.Id);

	/// <summary>The distinct colours the deck plays in (wilds excluded).</summary>
	public static List<string> DeckColors(IReadOnlyDictionary<string, SheddingCardDef> catalog)
		=> catalog.Values.Where(c => c.Color is { Length: > 0 })
			.Select(c => c.Color!).Distinct().ToList();

	/// <summary>Round-scoring points a card leaves in a loser's hand: the package's own
	/// figure, or the classic table (numbers their value, coloured actions 20, wilds 50).</summary>
	public static int PointsOf(SheddingCardDef def)
		=> def.Points ?? def.Type switch
		{
			"number" => def.Value,
			"wild" or "wildDrawFour" => 50,
			_ => 20,
		};

	public static SheddingSeatState SeatOf(SheddingState state, string playerId)
		=> state.Seats.First(s => s.PlayerId == playerId);

	/// <summary>The seats still playing, in seat order.</summary>
	public static List<SheddingSeatState> ActiveSeats(SheddingState state)
		=> state.Seats.Where(s => !s.Retired).ToList();

	/// <summary>The definition of the discard pile's top card.</summary>
	public static SheddingCardDef? TopDef(SheddingState state, IReadOnlyDictionary<string, SheddingCardDef> catalog)
		=> state.DiscardPile.Count > 0 ? catalog.GetValueOrDefault(state.DiscardPile[^1].CardId) : null;

	/// <summary>Keep the projected counts (all a rival ever sees) in sync with the piles.</summary>
	public static void SyncCounts(SheddingState state)
	{
		state.DrawCount = state.DrawPile.Count;
		state.DiscardCount = state.DiscardPile.Count;
		foreach (var seat in state.Seats)
		{
			seat.HandCount = seat.Hand.Count;
		}
	}

	// ── Game construction and the round deal ──────────────────────────────────

	/// <summary>Build the seats and deal round one.</summary>
	public static SheddingState CreateInitialState(
		IEnumerable<string> playerIds,
		IReadOnlyList<SheddingCardDef> deck,
		SheddingRulesConfig rules,
		IRandomSource random)
	{
		var state = new SheddingState
		{
			Seats = playerIds.Select(id => new SheddingSeatState { PlayerId = id }).ToList(),
		};
		DealRound(state, deck, rules, random);
		return state;
	}

	/// <summary>
	/// Deal a round from a FRESH full deck (every round reshuffles everything): hands of
	/// <see cref="SheddingRulesConfig.HandSize"/> round-robin to the active seats, then
	/// the opener flips from the pile until a NUMBER shows (validation guarantees one) —
	/// flipped action cards slide under the pile. Returns the opening card's definition.
	/// </summary>
	public static SheddingCardDef DealRound(
		SheddingState state,
		IReadOnlyList<SheddingCardDef> deck,
		SheddingRulesConfig rules,
		IRandomSource random)
	{
		var pile = new List<SheddingCardInstance>();
		foreach (var def in deck)
		{
			for (var copy = 0; copy < Math.Max(1, def.Count); copy++)
			{
				pile.Add(new SheddingCardInstance { InstanceId = $"{def.Id}#{copy}", CardId = def.Id });
			}
		}

		state.DrawPile.Clear();
		state.DrawPile.AddRange(random.Shuffle(pile));
		state.DiscardPile.Clear();
		foreach (var seat in state.Seats)
		{
			seat.Hand.Clear();
		}

		state.Direction = 1;
		state.PendingDrawnPlay = null;

		var catalog = Catalog(deck);
		for (var n = 0; n < rules.HandSize; n++)
		{
			foreach (var seat in ActiveSeats(state))
			{
				if (state.DrawPile.Count > 0)
				{
					seat.Hand.Add(state.DrawPile[^1]);
					state.DrawPile.RemoveAt(state.DrawPile.Count - 1);
				}
			}
		}

		// Flip the opener: actions slide under the pile until a number shows.
		SheddingCardDef opener;
		while (true)
		{
			var flipped = state.DrawPile[^1];
			state.DrawPile.RemoveAt(state.DrawPile.Count - 1);
			var def = catalog[flipped.CardId];
			if (def.Type == "number")
			{
				state.DiscardPile.Add(flipped);
				state.CurrentColor = def.Color!;
				opener = def;
				break;
			}
			state.DrawPile.Insert(0, flipped);
		}
		SyncCounts(state);
		return opener;
	}

	// ── Legality ──────────────────────────────────────────────────────────────

	public sealed record PlayCheck(bool Ok, string? ReasonKey = null)
	{
		public static readonly PlayCheck Yes = new(true);
		public static PlayCheck No(string reasonKey) => new(false, reasonKey);
	}

	/// <summary>The cards a penalty card makes the next player draw (2 / 4); 0 = not a draw card.</summary>
	public static int PenaltyDrawOf(string type) => type switch
	{
		"drawTwo" => 2,
		"wildDrawFour" => 4,
		_ => 0,
	};

	/// <summary>
	/// May this card pile onto the pending penalty, under the "stacking" house rule?
	/// "sameType" only lets a card of the SAME kind stack (a +2 on a +2, a +4 on a +4);
	/// "cross" lets any draw card stack on any; "none" lets nothing (the rule is off).
	/// </summary>
	public static bool CanStackOn(SheddingCardDef card, SheddingPenalty pending, SheddingRulesConfig rules)
	{
		if (PenaltyDrawOf(card.Type) == 0)
		{
			return false; // only draw cards can answer a penalty
		}

		return rules.Stacking switch
		{
			"sameType" => card.Type == pending.LastType,
			"cross" => true,
			_ => false,
		};
	}

	/// <summary>
	/// May this card land on the discards right now? Matching: the colour in force, an
	/// equal number value, or the same action type. Wilds always fit; the wild-draw only
	/// while the hand holds no card of the colour in force (server-enforced honesty —
	/// there is no challenge mechanic because there is nothing to bluff about). While a
	/// penalty is piling up (stacking rule), the ONLY legal play is another draw card that
	/// stacks — colour/number matching is bypassed, so a +2 answers any +2.
	/// </summary>
	public static PlayCheck CanPlay(
		SheddingCardDef card,
		SheddingSeatState seat,
		SheddingState state,
		SheddingRulesConfig rules,
		IReadOnlyDictionary<string, SheddingCardDef> catalog)
	{
		if (state.PendingPenalty is { } pending)
		{
			return CanStackOn(card, pending, rules)
				? PlayCheck.Yes
				: PlayCheck.No("game.shedding_must_stack");
		}

		switch (card.Type)
		{
			case "wild":
				return PlayCheck.Yes;

			case "wildDrawFour":
				return rules.WildDrawRequiresNoMatch && seat.Hand.Any(i =>
						catalog.GetValueOrDefault(i.CardId)?.Color == state.CurrentColor)
					? PlayCheck.No("game.shedding_wild_needs_no_match")
					: PlayCheck.Yes;

			default:
				{
					if (card.Color == state.CurrentColor)
					{
						return PlayCheck.Yes;
					}

					var top = TopDef(state, catalog);
					if (top == null)
					{
						return PlayCheck.No("game.shedding_not_playable");
					}

					if (card.Type == "number" && top.Type == "number" && card.Value == top.Value)
					{
						return PlayCheck.Yes;
					}

					if (card.Type != "number" && card.Type == top.Type)
					{
						return PlayCheck.Yes;
					}

					return PlayCheck.No("game.shedding_not_playable");
				}
		}
	}

	// ── The play ──────────────────────────────────────────────────────────────

	public sealed record PlayResult(
		bool Ok,
		string? ReasonKey = null,
		SheddingCardDef? Card = null,
		/// <summary>The colour the play left in force (the card's, or the wild's choice).</summary>
		string? ColorInForce = null,
		/// <summary>The next player loses their turn (skip, two-player reverse, penalties).</summary>
		bool SkipsNext = false,
		/// <summary>A reverse flipped the direction.</summary>
		bool Reversed = false,
		/// <summary>Cards the next player must draw (2 or 4); 0 = none. Under the stacking
		/// rule this is the RUNNING total the pile now holds (see <see cref="OpensPenaltyStack"/>).</summary>
		int PenaltyDraws = 0,
		/// <summary>The play piled a draw card onto the (stacking) penalty instead of
		/// landing it: the flow hands the growing total to the next player to answer,
		/// rather than making them draw now.</summary>
		bool OpensPenaltyStack = false,
		/// <summary>Extra identical copies shed alongside the card (the "doubles" rule); the
		/// flow announces how many cards left the hand in one go.</summary>
		int Copies = 1,
		/// <summary>The hand emptied: the round is won. (There is deliberately NO
		/// one-card-left shout: hand counts are on-demand information — the S/Shift+S
		/// status keys — so noticing a short hand stays part of the game.)</summary>
		bool RoundWon = false);

	/// <summary>Play a card from the hand (authoritative re-check of legality). Wilds
	/// carry the chosen colour; the drawn-card pause only lets its own card through.
	/// <paramref name="extraInstanceIds"/> are the further identical copies of a doubles
	/// play (the "doubles" house rule, number cards only).</summary>
	public static PlayResult Play(
		SheddingState state,
		string playerId,
		string instanceId,
		string? chosenColor,
		SheddingRulesConfig rules,
		IReadOnlyDictionary<string, SheddingCardDef> catalog,
		IReadOnlyList<string>? extraInstanceIds = null)
	{
		var seat = state.Seats.FirstOrDefault(s => s.PlayerId == playerId);
		if (seat == null || seat.Retired)
		{
			return new PlayResult(false, "game.shedding_not_seated");
		}

		var instance = seat.Hand.FirstOrDefault(c => c.InstanceId == instanceId);
		if (instance == null)
		{
			return new PlayResult(false, "game.shedding_card_not_in_hand");
		}

		var card = catalog.GetValueOrDefault(instance.CardId);
		if (card == null)
		{
			return new PlayResult(false, "game.shedding_unknown_card");
		}

		// Mid-pause the drawer may only play THE drawn card (or keep it): anything else
		// would be a play they already declined by drawing.
		if (state.PendingDrawnPlay is { } pending && pending.PlayerId == playerId
			&& pending.InstanceId != instanceId)
		{
			return new PlayResult(false, "game.shedding_only_drawn");
		}

		// Doubles: further copies must be identical number cards from the hand (the rule is
		// deliberately number-only, so no action effect ever multiplies).
		var extras = new List<SheddingCardInstance>();
		if (extraInstanceIds is { Count: > 0 })
		{
			if (!rules.AllowDoubles)
			{
				return new PlayResult(false, "game.shedding_no_doubles");
			}

			if (card.Type != "number")
			{
				return new PlayResult(false, "game.shedding_doubles_numbers_only");
			}

			var takenIds = new HashSet<string> { instance.InstanceId };
			foreach (var exId in extraInstanceIds)
			{
				if (!takenIds.Add(exId))
				{
					return new PlayResult(false, "game.shedding_card_not_in_hand");
				}

				var ex = seat.Hand.FirstOrDefault(c => c.InstanceId == exId);
				if (ex == null)
				{
					return new PlayResult(false, "game.shedding_card_not_in_hand");
				}

				if (ex.CardId != instance.CardId)
				{
					return new PlayResult(false, "game.shedding_doubles_not_identical");
				}

				extras.Add(ex);
			}
		}

		var check = CanPlay(card, seat, state, rules, catalog);
		if (!check.Ok)
		{
			return new PlayResult(false, check.ReasonKey);
		}

		var isWild = card.Type is "wild" or "wildDrawFour";
		if (isWild)
		{
			if (chosenColor == null || !DeckColors(catalog).Contains(chosenColor))
			{
				return new PlayResult(false, "game.shedding_bad_color");
			}
		}

		seat.Hand.Remove(instance);
		state.DiscardPile.Add(instance);
		foreach (var ex in extras)
		{
			seat.Hand.Remove(ex);
			state.DiscardPile.Add(ex);
		}
		state.CurrentColor = isWild ? chosenColor! : card.Color!;
		state.PendingDrawnPlay = null;

		var skips = false;
		var reversed = false;
		var penalty = 0;
		var opensStack = false;
		switch (card.Type)
		{
			case "skip":
				skips = true;
				break;
			case "reverse":
				state.Direction = -state.Direction;
				reversed = true;
				// With two seats the reverse comes straight back: it acts as a skip.
				skips = ActiveSeats(state).Count == 2;
				break;
			case "drawTwo":
			case "wildDrawFour":
				if (rules.Stacking != "none")
				{
					// Pile onto any penalty already in flight and hand it on — the victim
					// answers (stacks or draws the total) instead of drawing right now.
					penalty = (state.PendingPenalty?.Amount ?? 0) + PenaltyDrawOf(card.Type);
					opensStack = true;
				}
				else
				{
					penalty = PenaltyDrawOf(card.Type);
					skips = true; // classic: the victim draws now and loses the turn
				}
				break;
		}

		SyncCounts(state);
		return new PlayResult(true, Card: card,
			ColorInForce: state.CurrentColor,
			SkipsNext: skips, Reversed: reversed, PenaltyDraws: penalty,
			OpensPenaltyStack: opensStack, Copies: 1 + extras.Count,
			RoundWon: seat.Hand.Count == 0);
	}

	// ── Drawing ───────────────────────────────────────────────────────────────

	/// <summary>
	/// Draw up to <paramref name="count"/> cards into a seat, reshuffling the discards
	/// (all but the top card) into a fresh pile when the draw pile dries. May return
	/// fewer when nearly every card sits in hands.
	/// </summary>
	public static List<SheddingCardInstance> DrawInto(
		SheddingState state, SheddingSeatState seat, int count, IRandomSource random)
	{
		var drawn = new List<SheddingCardInstance>();
		for (var n = 0; n < count; n++)
		{
			if (state.DrawPile.Count == 0)
			{
				if (state.DiscardPile.Count <= 1)
				{
					break; // the top must stay
				}

				var buried = state.DiscardPile.Take(state.DiscardPile.Count - 1).ToList();
				var top = state.DiscardPile[^1];
				state.DiscardPile.Clear();
				state.DiscardPile.Add(top);
				state.DrawPile.AddRange(random.Shuffle(buried));
			}
			var card = state.DrawPile[^1];
			state.DrawPile.RemoveAt(state.DrawPile.Count - 1);
			seat.Hand.Add(card);
			drawn.Add(card);
		}
		SyncCounts(state);
		return drawn;
	}

	// ── Turn order ────────────────────────────────────────────────────────────

	/// <summary>
	/// The player after <paramref name="currentId"/> in the direction in force, walking
	/// past retired seats — two steps when the play skips its victim. The current player
	/// may themselves be retired (a leaver mid-turn): the walk starts from their chair.
	/// </summary>
	public static string NextPlayer(SheddingState state, string currentId, bool skipOne = false)
	{
		var seats = state.Seats;
		var index = seats.FindIndex(s => s.PlayerId == currentId);
		var steps = skipOne ? 2 : 1;
		for (var advanced = 0; advanced < steps; advanced++)
		{
			do { index = (index + state.Direction + seats.Count) % seats.Count; }
			while (seats[index].Retired);
		}
		return seats[index].PlayerId;
	}

	/// <summary>The victim of a skip/penalty: simply the next active player in force.</summary>
	public static string NextVictim(SheddingState state, string currentId)
		=> NextPlayer(state, currentId);

	// ── Round scoring ─────────────────────────────────────────────────────────

	public sealed record RoundScore(
		SheddingSeatState Winner,
		/// <summary>Points the winner collected from every rival hand this round.</summary>
		int Points,
		int Total);

	/// <summary>The round winner collects the points left in every rival hand; every
	/// hand empties (the next deal rebuilds the whole deck anyway).</summary>
	public static RoundScore ScoreRound(
		SheddingState state, string winnerId, IReadOnlyDictionary<string, SheddingCardDef> catalog)
	{
		var winner = SeatOf(state, winnerId);
		var points = state.Seats
			.Where(s => s.PlayerId != winnerId)
			.Sum(s => s.Hand.Sum(i => PointsOf(catalog.GetValueOrDefault(i.CardId) ?? new SheddingCardDef())));
		winner.Score += points;
		foreach (var seat in state.Seats)
		{
			seat.RoundScores.Add(seat.PlayerId == winnerId ? points : 0);
			seat.Hand.Clear();
		}
		SyncCounts(state);
		return new RoundScore(winner, points, winner.Score);
	}

	/// <summary>Final placings among the seats that finished: score first, then seat
	/// order keeps it stable. Retired players keep the place the leave flow gave them.</summary>
	public static List<SheddingSeatState> Placings(SheddingState state)
		=> ActiveSeats(state).OrderByDescending(s => s.Score).ToList();

	// ── Last-card declaration (house rule) ─────────────────────────────────────

	/// <summary>Declare the last card: clears the hook if it is on this player. Returns whether it
	/// applied (they were the one who had to declare).</summary>
	public static bool DeclareLastCard(SheddingState state, string playerId)
	{
		if (state.PendingLastCardCall != playerId)
		{
			return false;
		}

		state.PendingLastCardCall = null;
		return true;
	}

	/// <summary>Catch a player who forgot the last-card declaration. Returns the caught player id and
	/// clears the hook when there is a live hook on SOMEONE ELSE; null otherwise (nobody on
	/// the hook, or trying to catch yourself). The caller applies the penalty draw.</summary>
	public static string? CatchLastCard(SheddingState state, string callerId)
	{
		var target = state.PendingLastCardCall;
		if (target == null || target == callerId)
		{
			return null;
		}

		state.PendingLastCardCall = null;
		return target;
	}

	// ── Retirement (the shared leave-game flow) ───────────────────────────────

	/// <summary>
	/// Fold a leaver's seat: their hand slides UNDER the discards (it recirculates with
	/// the reshuffle instead of leaving the economy), a pause waiting on them clears,
	/// and the seat stops counting for the turn walk. The banked score stays as history.
	/// </summary>
	public static void Retire(SheddingState state, string playerId)
	{
		var seat = state.Seats.FirstOrDefault(s => s.PlayerId == playerId);
		if (seat == null || seat.Retired)
		{
			return;
		}

		seat.Retired = true;
		state.DiscardPile.InsertRange(0, seat.Hand);
		seat.Hand.Clear();
		if (state.PendingDrawnPlay?.PlayerId == playerId)
		{
			state.PendingDrawnPlay = null;
		}

		if (state.PendingLastCardCall == playerId)
		{
			state.PendingLastCardCall = null; // A leaver can no longer be caught for this declaration.
		}

		SyncCounts(state);
	}
}
