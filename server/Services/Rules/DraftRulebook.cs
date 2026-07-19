using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Rules;

/// <summary>
/// Pure rules of the "draft" game family (simultaneous pick-and-pass drafting): dealing,
/// the secret simultaneous pick (re-pickable until everyone commits), the reveal that
/// lands every pick on its public table at once, the leftward hand rotation, and the
/// scoring — per-round (points/multipliers, sets, scales, the majority race) and the
/// end-of-game dessert race. No I/O, no announcements, no transport — the flow layer
/// (DraftTurnFlow) drives these and owns the voice. Randomness is injected.
/// </summary>
public static class DraftRulebook
{
	// ── Catalog helpers ───────────────────────────────────────────────────────

	/// <summary>Index the deck catalog by card id (the state stores instances of ids).</summary>
	public static Dictionary<string, DraftCardDef> Catalog(IEnumerable<DraftCardDef> deck)
		=> deck.ToDictionary(c => c.Id);

	/// <summary>Opening hand size for a table of <paramref name="players"/>: the classic
	/// base-minus-players curve (more players, thinner hands, same tricks per round).</summary>
	public static int HandSizeFor(DraftRulesConfig rules, int players)
		=> rules.HandSizeBase - players;

	public static DraftSeatState SeatOf(DraftState state, string playerId)
		=> state.Seats.First(s => s.PlayerId == playerId);

	/// <summary>The seats still playing, in seat order (retired ones are skipped by the
	/// pick, the reveal, the rotation, the deal and every race).</summary>
	public static List<DraftSeatState> ActiveSeats(DraftState state)
		=> state.Seats.Where(s => !s.Retired).ToList();

	/// <summary>Keep the projected counts (all a rival ever sees) in sync with the piles.</summary>
	public static void SyncCounts(DraftState state)
	{
		state.DrawCount = state.DrawPile.Count;
		foreach (var seat in state.Seats)
		{
			seat.HandCount = seat.Hand.Count;
		}
	}

	// ── Game construction ─────────────────────────────────────────────────────

	/// <summary>Expand the catalog into the physical deck (Count copies, stable instance
	/// ids), shuffle it through the game's randomness source (identity in E2E, keeping the
	/// cards.json order) and deal the first round's hands.</summary>
	public static DraftState CreateInitialState(
		IEnumerable<string> playerIds,
		IReadOnlyList<DraftCardDef> deck,
		DraftRulesConfig rules,
		IRandomSource random)
	{
		var pile = new List<DraftCardInstance>();
		foreach (var def in deck)
		{
			for (var copy = 0; copy < Math.Max(1, def.Count); copy++)
			{
				pile.Add(new DraftCardInstance { InstanceId = $"{def.Id}#{copy}", CardId = def.Id });
			}
		}

		var state = new DraftState
		{
			Seats = playerIds.Select(id => new DraftSeatState { PlayerId = id }).ToList(),
			DrawPile = random.Shuffle(pile).ToList(),
		};
		DealRound(state, rules);
		return state;
	}

	/// <summary>Deal the current round's hands from the pile's tail, round-robin (same
	/// dealing order as the other card families, so the E2E identity shuffle produces
	/// known hands from the cards.json tail). Retired seats are dealt nothing — but the
	/// hand SIZE keeps the original table's curve, so the game the survivors signed up
	/// for doesn't change shape mid-match.</summary>
	public static void DealRound(DraftState state, DraftRulesConfig rules)
	{
		var handSize = HandSizeFor(rules, state.Seats.Count);
		for (var n = 0; n < handSize; n++)
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

		state.Trick = 1;
		SyncCounts(state);
	}

	// ── The simultaneous pick ─────────────────────────────────────────────────

	public sealed record CommitResult(
		bool Ok,
		string? ReasonKey = null,
		DraftCardDef? Card = null,
		/// <summary>The second card of a double pick (an "extra" on the table pays it).</summary>
		DraftCardDef? SecondCard = null,
		/// <summary>The seat had already picked this trick: this commit REPLACED it (legal
		/// until the last player commits — nothing was revealed yet).</summary>
		bool Replaced = false,
		/// <summary>Every seat with cards has now committed: the flow must reveal.</summary>
		bool AllCommitted = false);

	/// <summary>An unspent "extra" slot on the seat's table (pays for a double pick).</summary>
	public static DraftTableSlot? UnspentExtra(
		DraftSeatState seat, IReadOnlyDictionary<string, DraftCardDef> catalog)
		=> seat.Table.FirstOrDefault(slot =>
			catalog.GetValueOrDefault(slot.Card.CardId)?.Type == "extra");

	/// <summary>Commit (or re-commit) the seat's secret pick for this trick. A second
	/// card needs an "extra" waiting on the table; a re-commit replaces BOTH slots.</summary>
	public static CommitResult Commit(
		DraftState state,
		string playerId,
		string instanceId,
		string? secondInstanceId,
		IReadOnlyDictionary<string, DraftCardDef> catalog)
	{
		var seat = state.Seats.FirstOrDefault(s => s.PlayerId == playerId);
		if (seat == null || seat.Retired)
		{
			return new CommitResult(false, "game.draft_not_seated");
		}

		var instance = seat.Hand.FirstOrDefault(c => c.InstanceId == instanceId);
		if (instance == null)
		{
			return new CommitResult(false, "game.draft_not_in_hand");
		}

		var card = catalog.GetValueOrDefault(instance.CardId);
		if (card == null)
		{
			return new CommitResult(false, "game.draft_unknown_card");
		}

		DraftCardDef? secondCard = null;
		if (secondInstanceId != null)
		{
			if (secondInstanceId == instanceId)
			{
				return new CommitResult(false, "game.draft_same_card");
			}

			var second = seat.Hand.FirstOrDefault(c => c.InstanceId == secondInstanceId);
			if (second == null)
			{
				return new CommitResult(false, "game.draft_not_in_hand");
			}

			secondCard = catalog.GetValueOrDefault(second.CardId);
			if (secondCard == null)
			{
				return new CommitResult(false, "game.draft_unknown_card");
			}

			if (UnspentExtra(seat, catalog) == null)
			{
				return new CommitResult(false, "game.draft_needs_extra");
			}
		}

		var replaced = seat.HasPicked;
		seat.CommittedInstanceId = instanceId;
		seat.CommittedSecondId = secondInstanceId;
		seat.HasPicked = true;

		return new CommitResult(true, Card: card, SecondCard: secondCard, Replaced: replaced,
			AllCommitted: TrickComplete(state));
	}

	/// <summary>Every seat still playing has committed (or holds nothing): reveal time.</summary>
	public static bool TrickComplete(DraftState state)
		=> ActiveSeats(state).All(s => s.Hand.Count == 0 || s.HasPicked);

	// ── The reveal ────────────────────────────────────────────────────────────

	public sealed record RevealEntry(
		DraftSeatState Seat,
		DraftCardDef Card,
		/// <summary>The multiplier this points card landed on (already on the seat's table
		/// from an earlier trick — or the FIRST card of this very double pick), or null.</summary>
		DraftCardDef? Multiplier,
		/// <summary>Set on the SECOND card of a double pick: the "extra" that paid for it
		/// and just rejoined the passing hand.</summary>
		DraftCardDef? SpentExtra = null);

	public sealed record RevealResult(
		IReadOnlyList<RevealEntry> Entries,
		/// <summary>The hands ran out: the round must be scored (no rotation happened).</summary>
		bool RoundEnded);

	/// <summary>
	/// Reveal every committed pick at once: each card leaves its hand for its seat's
	/// public surface — desserts to the dessert stash, everything else to the table, a
	/// points card landing on the seat's oldest unused multiplier (one placed on an
	/// EARLIER trick, or the first card of the same double pick — first resolves first).
	/// A double pick then sends its "extra" from the table back into the hand, so it
	/// travels with the pass. Then the shrunken hands rotate one seat to the left —
	/// unless they ran out, which ends the round.
	/// </summary>
	public static RevealResult Reveal(DraftState state, IReadOnlyDictionary<string, DraftCardDef> catalog)
	{
		var entries = new List<RevealEntry>();
		foreach (var seat in state.Seats)
		{
			if (seat.CommittedInstanceId is not { } picked)
			{
				continue;
			}

			var second = seat.CommittedSecondId;
			seat.CommittedInstanceId = null;
			seat.CommittedSecondId = null;
			seat.HasPicked = false;

			entries.Add(ResolvePick(seat, picked, catalog));
			if (second != null)
			{
				var entry = ResolvePick(seat, second, catalog);
				// The extra paid its double: off the table, back into the passing hand.
				var extra = UnspentExtra(seat, catalog)!;
				seat.Table.Remove(extra);
				seat.Hand.Add(extra.Card);
				entries.Add(entry with { SpentExtra = catalog[extra.Card.CardId] });
			}
		}

		var active = ActiveSeats(state);
		var roundEnded = active.All(s => s.Hand.Count == 0);
		if (!roundEnded)
		{
			// Leftward rotation among the seats still playing: each hands its remaining
			// cards to the NEXT active seat (a retired chair is skipped, not a black hole).
			var hands = active.Select(s => s.Hand).ToList();
			for (var index = 0; index < active.Count; index++)
			{
				active[(index + 1) % active.Count].Hand = hands[index];
			}

			state.Trick++;
		}
		SyncCounts(state);
		return new RevealResult(entries, roundEnded);
	}

	/// <summary>One revealed card leaves the hand for its public destination: the dessert
	/// stash, an unused multiplier (points cards) or a plain table slot.</summary>
	private static RevealEntry ResolvePick(
		DraftSeatState seat, string instanceId, IReadOnlyDictionary<string, DraftCardDef> catalog)
	{
		var instance = seat.Hand.First(c => c.InstanceId == instanceId);
		seat.Hand.Remove(instance);

		var card = catalog[instance.CardId];
		DraftCardDef? multiplier = null;
		if (card.Type == "dessert")
		{
			seat.Desserts.Add(instance);
		}
		else if (card.Type == "points")
		{
			var free = seat.Table.FirstOrDefault(slot =>
				catalog.GetValueOrDefault(slot.Card.CardId)?.Type == "multiplier");
			if (free != null)
			{
				seat.Table.Remove(free);
				seat.Table.Add(new DraftTableSlot { Card = instance, OnMultiplier = free.Card });
				multiplier = catalog[free.Card.CardId];
			}
			else
			{
				seat.Table.Add(new DraftTableSlot { Card = instance });
			}
		}
		else
		{
			seat.Table.Add(new DraftTableSlot { Card = instance });
		}
		return new RevealEntry(seat, card, multiplier);
	}

	// ── Round scoring ─────────────────────────────────────────────────────────

	public sealed record RoundScore(DraftSeatState Seat, int Points, int Total);

	/// <summary>
	/// Score the finished round: points cards (× their multiplier), complete sets, scale
	/// ladders and the single majority race across all seats. Adds each seat's points to
	/// its running total, records the round breakdown and CLEARS the tables (revealed
	/// cards leave the game; desserts already sit in their stash for the end).
	/// </summary>
	public static List<RoundScore> ScoreRound(
		DraftState state, IReadOnlyDictionary<string, DraftCardDef> catalog, DraftRulesConfig rules)
	{
		var points = state.Seats.ToDictionary(s => s.PlayerId, s => TablePoints(s, catalog));

		foreach (var (playerId, prize) in MajorityPrizes(state, catalog, rules))
		{
			points[playerId] += prize;
		}

		var scores = new List<RoundScore>();
		foreach (var seat in ActiveSeats(state))
		{
			var earned = points[seat.PlayerId];
			seat.Score += earned;
			seat.RoundScores.Add(earned);
			seat.Table.Clear();
			scores.Add(new RoundScore(seat, earned, seat.Score));
		}
		SyncCounts(state);
		return scores;
	}

	/// <summary>One seat's table, majority race excluded (that one spans all seats).</summary>
	private static int TablePoints(DraftSeatState seat, IReadOnlyDictionary<string, DraftCardDef> catalog)
	{
		var total = 0;
		var copies = new Dictionary<string, int>();
		foreach (var slot in seat.Table)
		{
			var def = catalog.GetValueOrDefault(slot.Card.CardId);
			if (def == null)
			{
				continue;
			}

			switch (def.Type)
			{
				case "points":
					var factor = slot.OnMultiplier is { } boost
						? Math.Max(1, catalog.GetValueOrDefault(boost.CardId)?.Factor ?? 1)
						: 1;
					total += def.Value * factor;
					break;
				case "set" or "scale":
					copies[def.Id] = copies.GetValueOrDefault(def.Id) + 1;
					break;
					// multiplier alone: worth nothing. majority: raced across seats below.
			}
		}
		foreach (var (cardId, count) in copies)
		{
			var def = catalog[cardId];
			if (def.Type == "set" && def.SetSize > 0)
			{
				total += count / def.SetSize * def.SetPoints;
			}
			else if (def.Type == "scale" && def.Scale.Count > 0)
			{
				total += def.Scale[Math.Min(count, def.Scale.Count) - 1];
			}
		}
		return total;
	}

	/// <summary>
	/// The round's majority race: seats with the most icons split the first prize; the
	/// runners-up split the second only when first place wasn't tied (a tie up top eats
	/// it, as in the classic game). Splits round down; zero-icon seats never place.
	/// </summary>
	public static List<(string PlayerId, int Prize)> MajorityPrizes(
		DraftState state, IReadOnlyDictionary<string, DraftCardDef> catalog, DraftRulesConfig rules)
	{
		var icons = state.Seats.ToDictionary(
			s => s.PlayerId,
			s => s.Table.Sum(slot => catalog.GetValueOrDefault(slot.Card.CardId) is { Type: "majority" } def
				? def.Icons : 0));

		var prizes = new List<(string, int)>();
		var best = icons.Values.Max();
		if (best <= 0)
		{
			return prizes;
		}

		var winners = icons.Where(kv => kv.Value == best).Select(kv => kv.Key).ToList();
		foreach (var id in winners)
		{
			prizes.Add((id, rules.MajorityFirst / winners.Count));
		}

		if (winners.Count == 1)
		{
			var second = icons.Values.Where(v => v < best).DefaultIfEmpty(0).Max();
			if (second > 0)
			{
				var runners = icons.Where(kv => kv.Value == second).Select(kv => kv.Key).ToList();
				foreach (var id in runners)
				{
					prizes.Add((id, rules.MajoritySecond / runners.Count));
				}
			}
		}
		return prizes;
	}

	// ── Dessert scoring (game end) ────────────────────────────────────────────

	public sealed record DessertScore(DraftSeatState Seat, int Delta, int Total);

	/// <summary>
	/// The end-of-game dessert race: most desserts split the bonus, fewest split the
	/// penalty (rounded down). Two-player games skip the penalty, and when everyone is
	/// tied the whole table just splits the bonus — nobody both wins and loses.
	/// </summary>
	public static List<DessertScore> ScoreDesserts(DraftState state, DraftRulesConfig rules)
	{
		// Only the seats still playing race for the desserts (a retired stash is inert).
		var racers = ActiveSeats(state);
		var most = racers.Max(s => s.Desserts.Count);
		var least = racers.Min(s => s.Desserts.Count);

		var winners = racers.Where(s => s.Desserts.Count == most).ToList();
		var losers = most == least || racers.Count <= 2
			? new List<DraftSeatState>()
			: racers.Where(s => s.Desserts.Count == least).ToList();

		var scores = new List<DessertScore>();
		foreach (var seat in racers)
		{
			var delta = 0;
			if (winners.Contains(seat))
			{
				delta += rules.DessertBonus / winners.Count;
			}

			if (losers.Contains(seat))
			{
				delta -= rules.DessertPenalty / losers.Count;
			}

			if (delta != 0)
			{
				seat.Score += delta;
				scores.Add(new DessertScore(seat, delta, seat.Score));
			}
		}
		return scores;
	}

	/// <summary>Final placings among the seats that FINISHED: score first, then the
	/// dessert stash breaks ties (the classic tiebreaker), then seat order keeps it
	/// stable. Retired players already hold the place the leave flow gave them.</summary>
	public static List<DraftSeatState> Placings(DraftState state)
		=> ActiveSeats(state)
			.OrderByDescending(s => s.Score)
			.ThenByDescending(s => s.Desserts.Count)
			.ToList();

	// ── Retirement (the shared leave-game flow) ───────────────────────────────

	/// <summary>
	/// Fold a leaver's seat so the game never stalls on them: their hand and unscored
	/// table leave the game (the banked score and dessert stash stay on the board as
	/// history), the seat stops counting for picks, rotation, deals and races. Returns
	/// true when the fold COMPLETED the current trick — the caller must reveal, exactly
	/// as if the leaver had been the last to pick.
	/// </summary>
	public static bool Retire(DraftState state, string playerId)
	{
		var seat = state.Seats.FirstOrDefault(s => s.PlayerId == playerId);
		if (seat == null || seat.Retired)
		{
			return false;
		}

		seat.Retired = true;
		seat.Hand.Clear();
		seat.Table.Clear();
		seat.CommittedInstanceId = null;
		seat.CommittedSecondId = null;
		seat.HasPicked = false;
		SyncCounts(state);

		// Someone must still be mid-pick for a reveal to be pending at all.
		var active = ActiveSeats(state);
		return active.Any(s => s.HasPicked) && TrickComplete(state);
	}
}
