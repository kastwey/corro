using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Rules;

/// <summary>
/// Pure rules of the "journey" game family (Mil Millas genre): which cards may be played on
/// whom, what they do, the coup fourré interrupt, when a hand ends, the official scoring
/// table and the match across hands. No I/O, no announcements, no transport — the turn flow
/// (a later layer) drives these and owns the voice. Randomness is injected (deck shuffles).
///
/// Modeling note: there is no special "start" mechanic. Every seat begins the hand under the
/// board's INITIAL HAZARD (classically "stop"), so the green light is just a remedy and the
/// right-of-way immunity shields it like any other hazard.
/// </summary>
public static class JourneyRulebook
{
	// ── Catalog helpers ───────────────────────────────────────────────────────

	/// <summary>Index the deck catalog by card id (the state stores ids only).</summary>
	public static Dictionary<string, JourneyCardDef> Catalog(IEnumerable<JourneyCardDef> deck)
		=> deck.ToDictionary(c => c.Id);

	/// <summary>The class ("stopper"/"limiter") of a hazard KIND, from the attack that inflicts it.</summary>
	private static string? HazardClassOf(string kind, IReadOnlyDictionary<string, JourneyCardDef> catalog)
		=> catalog.Values.FirstOrDefault(c => c.Type == "attack" && c.Kind == kind)?.HazardClass;

	/// <summary>Every hazard kind this seat is shielded against by its played immunities.</summary>
	public static HashSet<string> ShieldedKinds(JourneySeatState seat, IReadOnlyDictionary<string, JourneyCardDef> catalog)
		=> seat.Immunities
			.Select(id => catalog.GetValueOrDefault(id))
			.Where(def => def != null)
			.SelectMany(def => def!.ShieldsKinds.Count > 0 ? def.ShieldsKinds : (def.Kind is { } k ? new List<string> { k } : new()))
			.ToHashSet();

	/// <summary>A stopper hazard blocks all distance play.</summary>
	public static bool IsStopped(JourneySeatState seat, IReadOnlyDictionary<string, JourneyCardDef> catalog)
		=> seat.Hazards.Any(kind => HazardClassOf(kind, catalog) == "stopper");

	/// <summary>A limiter hazard caps the distance value the seat may play.</summary>
	public static bool IsLimited(JourneySeatState seat, IReadOnlyDictionary<string, JourneyCardDef> catalog)
		=> seat.Hazards.Any(kind => HazardClassOf(kind, catalog) == "limiter");

	// ── Hand construction ─────────────────────────────────────────────────────

	/// <summary>Expand the catalog into the physical deck (Count copies, stable instance ids),
	/// shuffle it through the game's randomness source (identity in E2E/scripted tests, so
	/// decks keep their cards.json order there) and deal every MEMBER their opening hand.
	/// Each seating is one seat's members: singletons in individual play, whole teams in team
	/// play (the shared seat). Seats start under the initial hazard.</summary>
	public static JourneyState CreateInitialState(
		IEnumerable<IReadOnlyList<string>> seatings,
		IReadOnlyList<JourneyCardDef> deck,
		JourneyRulesConfig rules,
		IRandomSource random)
	{
		var state = new JourneyState
		{
			Seats = seatings.Select(members => NewSeat(members, rules)).ToList(),
			DrawPile = BuildShuffledPile(deck, random),
		};
		DealOpeningHands(state, rules);
		SyncCounts(state);
		return state;
	}

	/// <summary>A fresh hand of the SAME match: new deck/hands/kilometres, scores carried over.</summary>
	public static JourneyState StartNextHand(
		JourneyState finished,
		IReadOnlyList<JourneyCardDef> deck,
		JourneyRulesConfig rules,
		IRandomSource random)
	{
		var state = new JourneyState
		{
			Seats = finished.Seats.Select(s =>
			{
				var seat = NewSeat(s.Members.Select(m => m.PlayerId).ToList(), rules);
				seat.Score = s.Score;
				return seat;
			}).ToList(),
			DrawPile = BuildShuffledPile(deck, random),
			Round = finished.Round + 1,
		};
		DealOpeningHands(state, rules);
		SyncCounts(state);
		return state;
	}

	private static JourneySeatState NewSeat(IReadOnlyList<string> members, JourneyRulesConfig rules)
	{
		var seat = new JourneySeatState
		{
			PlayerId = members[0], // the seat's stable wire id
			Members = members.Select(id => new JourneyMemberState { PlayerId = id }).ToList(),
		};
		if (!string.IsNullOrEmpty(rules.InitialHazard))
		{
			seat.Hazards.Add(rules.InitialHazard);
		}

		return seat;
	}

	private static List<JourneyCardInstance> BuildShuffledPile(
		IReadOnlyList<JourneyCardDef> deck, IRandomSource random)
	{
		var pile = new List<JourneyCardInstance>();
		foreach (var def in deck)
		{
			for (var copy = 0; copy < Math.Max(1, def.Count); copy++)
			{
				pile.Add(new JourneyCardInstance { InstanceId = $"{def.Id}#{copy}", CardId = def.Id });
			}
		}

		return random.Shuffle(pile).ToList();
	}

	private static void DealOpeningHands(JourneyState state, JourneyRulesConfig rules)
	{
		for (var n = 0; n < rules.HandSize; n++)
		{
			foreach (var member in state.Seats.SelectMany(s => s.Members))
			{
				if (state.DrawPile.Count > 0)
				{
					member.Hand.Add(state.DrawPile[^1]);
					state.DrawPile.RemoveAt(state.DrawPile.Count - 1);
				}
			}
		}
	}

	/// <summary>Keep the projected counts (all a rival ever sees) in sync with the real piles.</summary>
	public static void SyncCounts(JourneyState state)
	{
		state.DrawCount = state.DrawPile.Count;
		foreach (var member in state.Seats.SelectMany(s => s.Members))
		{
			member.HandCount = member.Hand.Count;
		}
	}

	// ── Legality ──────────────────────────────────────────────────────────────

	public sealed record PlayCheck(bool Ok, string? ReasonKey = null)
	{
		public static readonly PlayCheck Yes = new(true);
		public static PlayCheck No(string reasonKey) => new(false, reasonKey);
	}

	/// <summary>
	/// May <paramref name="seat"/> play this card (on <paramref name="target"/> when it is an
	/// attack)? Reasons are i18n keys, spoken as-is by the client refusal path.
	/// </summary>
	public static PlayCheck CanPlay(
		JourneyCardDef card,
		JourneySeatState seat,
		JourneySeatState? target,
		JourneyRulesConfig rules,
		IReadOnlyDictionary<string, JourneyCardDef> catalog)
	{
		if (card.MaxPlaysPerHand is { } max && seat.PlaysByCard.GetValueOrDefault(card.Id) >= max)
		{
			return PlayCheck.No("game.journey_card_limit");
		}

		switch (card.Type)
		{
			case "distance":
				if (IsStopped(seat, catalog))
				{
					return PlayCheck.No("game.journey_stopped");
				}

				if (IsLimited(seat, catalog) && card.Value > rules.LimitCap)
				{
					return PlayCheck.No("game.journey_over_limit");
				}

				if (seat.Km + card.Value > rules.GoalKm)
				{
					return PlayCheck.No("game.journey_overshoot");
				}

				return PlayCheck.Yes;

			case "attack":
				{
					// A retired seat is not a target: nobody is driving that car any more.
					if (target == null || target.PlayerId == seat.PlayerId || target.Retired)
					{
						return PlayCheck.No("game.journey_needs_target");
					}

					var kind = card.Kind ?? string.Empty;
					if (ShieldedKinds(target, catalog).Contains(kind))
					{
						return PlayCheck.No("game.journey_target_immune");
					}

					if (target.Hazards.Contains(kind))
					{
						return PlayCheck.No("game.journey_target_already");
					}
					// Officially a STOPPER needs a rolling victim (the stack-hazards house rule
					// lifts that); a LIMITER rides its own pile and lands on stopped victims too.
					if (card.HazardClass == "stopper" && IsStopped(target, catalog) && !rules.StackHazards)
					{
						return PlayCheck.No("game.journey_target_stopped");
					}

					return PlayCheck.Yes;
				}

			case "remedy":
				return seat.Hazards.Contains(card.Kind ?? string.Empty)
					? PlayCheck.Yes
					: PlayCheck.No("game.journey_nothing_to_cure");

			case "immunity":
				return PlayCheck.Yes;

			default:
				return PlayCheck.No("game.journey_unknown_card");
		}
	}

	// ── Turn actions (mutating; the flow layer validates whose turn it is) ────

	public sealed record DrawResult(bool Ok, string? ReasonKey = null, JourneyCardInstance? Card = null);

	/// <summary>Draw the top card into the player's OWN hand (once per turn, flow-enforced).
	/// An empty pile refuses — play continues without drawing until the hand ends.</summary>
	public static DrawResult Draw(JourneyState state, string playerId)
	{
		var member = MemberOf(state, playerId);
		if (state.DrawPile.Count == 0)
		{
			return new DrawResult(false, "game.journey_deck_empty");
		}

		var card = state.DrawPile[^1];
		state.DrawPile.RemoveAt(state.DrawPile.Count - 1);
		member.Hand.Add(card);
		state.HasDrawn = true;
		SyncCounts(state);
		return new DrawResult(true, Card: card);
	}

	public sealed record PlayResult(
		bool Ok,
		string? ReasonKey = null,
		JourneyCardDef? Card = null,
		/// <summary>The hazard landed on a victim holding the matching immunity: the game
		/// pauses on their coup fourré decision (state.PendingCoup is set).</summary>
		bool CoupOffered = false,
		/// <summary>The seat reached the goal: the hand is over.</summary>
		bool HandComplete = false);

	/// <summary>Play a card from the hand (authoritative re-check of legality).</summary>
	public static PlayResult Play(
		JourneyState state,
		string playerId,
		string instanceId,
		string? targetId,
		JourneyRulesConfig rules,
		IReadOnlyDictionary<string, JourneyCardDef> catalog)
	{
		var seat = SeatOf(state, playerId);
		// You play YOUR OWN cards (a partner's hand is private even from you).
		var member = MemberOf(state, playerId);
		var instance = member.Hand.FirstOrDefault(c => c.InstanceId == instanceId);
		if (instance == null)
		{
			return new PlayResult(false, "game.journey_card_not_in_hand");
		}

		var card = catalog.GetValueOrDefault(instance.CardId);
		if (card == null)
		{
			return new PlayResult(false, "game.journey_unknown_card");
		}
		// Any member id targets their whole SEAT (attacking your partner = attacking
		// yourself: refused by the seat-identity check inside CanPlay).
		var target = targetId == null ? null : SeatOf(state, targetId);

		var check = CanPlay(card, seat, target, rules, catalog);
		if (!check.Ok)
		{
			return new PlayResult(false, check.ReasonKey);
		}

		member.Hand.Remove(instance);
		seat.PlaysByCard[card.Id] = seat.PlaysByCard.GetValueOrDefault(card.Id) + 1;
		if (card.Premium)
		{
			seat.PremiumPlays++;
		}

		var coupOffered = false;
		var handComplete = false;
		switch (card.Type)
		{
			case "distance":
				seat.Km += card.Value;
				handComplete = seat.Km == rules.GoalKm;
				break;

			case "attack":
				{
					var kind = card.Kind ?? string.Empty;
					target!.Hazards.Add(kind);
					// The coup fourré window: a member of the victim SEAT holds the immunity
					// that shields this kind. The game pauses on THAT member's decision
					// (accept = cancel + bonus + the turn passes to them).
					var holder = target.Members
						.Select(m => new
						{
							Member = m,
							Shield = m.Hand.FirstOrDefault(c =>
								catalog.GetValueOrDefault(c.CardId) is { Type: "immunity" } def && Shields(def, kind)),
						})
						.FirstOrDefault(x => x.Shield != null);
					if (holder != null)
					{
						state.PendingCoup = new PendingJourneyCoup
						{
							VictimId = holder.Member.PlayerId,
							AttackerId = playerId,
							HazardKind = kind,
							ImmunityInstanceId = holder.Shield!.InstanceId,
						};
						coupOffered = true;
					}
					break;
				}

			case "remedy":
				{
					var cured = card.Kind ?? string.Empty;
					seat.Hazards.Remove(cured);
					// Official rule: a remedy REPAIRS, it does not restart. Curing a stopper
					// other than the go-signal itself leaves the car waiting for the green
					// light (the initial hazard again), unless an immunity shields it (right
					// of way) or the wait is already in place (stacked stoppers share one).
					var wait = rules.InitialHazard;
					if (!string.IsNullOrEmpty(wait) && cured != wait
						&& HazardClassOf(cured, catalog) == "stopper"
						&& !seat.Hazards.Contains(wait)
						&& !ShieldedKinds(seat, catalog).Contains(wait))
					{
						seat.Hazards.Add(wait);
					}
					break;
				}

			case "immunity":
				ApplyImmunity(seat, card);
				break;
		}

		SyncCounts(state);
		return new PlayResult(true, Card: card, CoupOffered: coupOffered, HandComplete: handComplete);
	}

	public sealed record DiscardResult(bool Ok, string? ReasonKey = null, JourneyCardDef? Card = null);

	/// <summary>Discard from the player's OWN hand onto the face-up pile (the turn's alternative to playing).</summary>
	public static DiscardResult Discard(JourneyState state, string playerId, string instanceId,
		IReadOnlyDictionary<string, JourneyCardDef> catalog)
	{
		var member = MemberOf(state, playerId);
		var instance = member.Hand.FirstOrDefault(c => c.InstanceId == instanceId);
		if (instance == null)
		{
			return new DiscardResult(false, "game.journey_card_not_in_hand");
		}

		member.Hand.Remove(instance);
		state.DiscardPile.Add(instance);
		SyncCounts(state);
		return new DiscardResult(true, Card: catalog.GetValueOrDefault(instance.CardId));
	}

	public sealed record CoupResult(bool Ok, string? ReasonKey = null, bool Accepted = false);

	/// <summary>
	/// Resolve the pending coup fourré. Accepting cancels the hazard, plays the immunity out
	/// of turn, counts the bonus and (officially) hands the TURN to the victim — the flow
	/// layer moves CurrentTurn when this returns accepted. Declining leaves the hazard.
	/// </summary>
	public static CoupResult ResolveCoup(JourneyState state, string playerId, bool accept,
		IReadOnlyDictionary<string, JourneyCardDef> catalog)
	{
		var pending = state.PendingCoup;
		if (pending == null || pending.VictimId != playerId)
		{
			return new CoupResult(false, "game.journey_no_coup");
		}

		state.PendingCoup = null;
		if (!accept)
		{
			return new CoupResult(true, Accepted: false);
		}

		var seat = SeatOf(state, playerId);
		var member = MemberOf(state, playerId);
		var instance = member.Hand.FirstOrDefault(c => c.InstanceId == pending.ImmunityInstanceId);
		if (instance == null)
		{
			return new CoupResult(false, "game.journey_card_not_in_hand");
		}

		var card = catalog.GetValueOrDefault(instance.CardId);
		if (card == null)
		{
			return new CoupResult(false, "game.journey_unknown_card");
		}

		member.Hand.Remove(instance);
		ApplyImmunity(seat, card);
		seat.CoupFourres++;
		// The classic replacement draw, when the pile still has cards.
		if (state.DrawPile.Count > 0)
		{
			member.Hand.Add(state.DrawPile[^1]);
			state.DrawPile.RemoveAt(state.DrawPile.Count - 1);
		}
		SyncCounts(state);
		return new CoupResult(true, Accepted: true);
	}

	private static void ApplyImmunity(JourneySeatState seat, JourneyCardDef card)
	{
		seat.Immunities.Add(card.Id);
		foreach (var kind in card.ShieldsKinds.Count > 0 ? card.ShieldsKinds : (card.Kind is { } k ? new List<string> { k } : new()))
		{
			seat.Hazards.Remove(kind);
		}
	}

	private static bool Shields(JourneyCardDef immunity, string kind)
		=> immunity.ShieldsKinds.Count > 0 ? immunity.ShieldsKinds.Contains(kind) : immunity.Kind == kind;

	/// <summary>The seat this player occupies — alone, or shared with their team.</summary>
	public static JourneySeatState SeatOf(JourneyState state, string playerId)
		=> state.Seats.First(s => s.Members.Any(m => m.PlayerId == playerId));

	/// <summary>The player's own member slot (their private hand) inside their seat.</summary>
	public static JourneyMemberState MemberOf(JourneyState state, string playerId)
		=> SeatOf(state, playerId).Members.First(m => m.PlayerId == playerId);

	// ── Hand end, scoring, match ──────────────────────────────────────────────

	/// <summary>A hand ends when a seat completes the goal, or the pile is exhausted and every
	/// hand has been played/discarded down to empty (without drawing, hands only shrink, so
	/// this always terminates).</summary>
	public static bool HandOver(JourneyState state, JourneyRulesConfig rules)
		=> state.Seats.Any(s => s.Km == rules.GoalKm)
			|| (state.DrawPile.Count == 0 && state.Seats.SelectMany(s => s.Members).All(m => m.Hand.Count == 0));

	/// <summary>Score a finished hand with the official table and add it to the match scores.</summary>
	public static List<JourneyHandScore> ScoreHand(JourneyState state,
		IReadOnlyDictionary<string, JourneyCardDef> catalog, JourneyRulesConfig rules)
	{
		var immunityDefs = catalog.Values.Count(c => c.Type == "immunity");
		var scores = new List<JourneyHandScore>();
		foreach (var seat in state.Seats)
		{
			var completed = seat.Km == rules.GoalKm;
			var allImmunities = immunityDefs > 0 && seat.Immunities.Distinct().Count() == immunityDefs;
			var capot = completed && state.Seats.Any(r => r.PlayerId != seat.PlayerId && r.Km == 0);

			var score = new JourneyHandScore
			{
				PlayerId = seat.PlayerId,
				Km = seat.Km * rules.PointsPerKm,
				ImmunityPoints = seat.Immunities.Count * rules.ImmunityPoints,
				AllImmunitiesBonus = allImmunities ? rules.AllImmunitiesBonus : 0,
				CoupFourrePoints = seat.CoupFourres * rules.CoupFourreBonus,
				TripCompleteBonus = completed ? rules.TripCompleteBonus : 0,
				SafeTripBonus = completed && seat.PremiumPlays == 0 ? rules.SafeTripBonus : 0,
				DeckExhaustedBonus = completed && state.DrawPile.Count == 0 ? rules.DeckExhaustedBonus : 0,
				CapotBonus = capot ? rules.CapotBonus : 0,
			};
			var total = score.Km + score.ImmunityPoints + score.AllImmunitiesBonus + score.CoupFourrePoints
				+ score.TripCompleteBonus + score.SafeTripBonus + score.DeckExhaustedBonus + score.CapotBonus;
			seat.Score += total;
			scores.Add(score with { Total = total, MatchScore = seat.Score });
		}
		state.LastHandScores.Clear();
		state.LastHandScores.AddRange(scores);
		return scores;
	}

	/// <summary>The match ends when a seat crosses the target score — or, with target 0
	/// ("single hand"), as soon as the hand does.</summary>
	public static bool MatchOver(JourneyState state, JourneyRulesConfig rules)
		=> rules.TargetScore == 0 || state.Seats.Any(s => s.Score >= rules.TargetScore);
}
