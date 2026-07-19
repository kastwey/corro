using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Rules;

/// <summary>
/// Pure rules of the assembly game family: which cards may be played on
/// whom, what they do, the refill at the end of the turn (reshuffling the face-down discards
/// when the pile dries) and the win check. No I/O, no announcements, no transport — the turn
/// flow (a later layer) drives these and owns the voice. Randomness is injected.
///
/// Slot lifecycle: healthy → afflicted (one attack) → destroyed (second attack removes the
/// slot); healthy → shielded (one remedy) → locked (second remedy: untouchable). An attack
/// on a shielded slot burns the shield instead. The "wild" colour matches anything.
/// </summary>
public static class AssemblyRulebook
{
	public const string Wild = "wild";

	// ── Catalog helpers ───────────────────────────────────────────────────────

	/// <summary>Index the deck catalog by card id (the state stores instances of ids).</summary>
	public static Dictionary<string, AssemblyCardDef> Catalog(IEnumerable<AssemblyCardDef> deck)
		=> deck.ToDictionary(c => c.Id);

	/// <summary>The distinct REAL colours (wild excluded) the deck's pieces come in.</summary>
	public static List<string> PieceColors(IReadOnlyDictionary<string, AssemblyCardDef> catalog)
		=> catalog.Values.Where(c => c.Type == "piece" && c.Color is { } col && col != Wild)
			.Select(c => c.Color!).Distinct().ToList();

	/// <summary>A card colour matches a slot colour when either is wild or they are equal.</summary>
	public static bool ColorMatches(string? cardColor, string slotColor)
		=> cardColor == Wild || slotColor == Wild || cardColor == slotColor;

	// ── Slot state ────────────────────────────────────────────────────────────

	/// <summary>Locked (two shields): untouchable by attacks and specials, forever functional.</summary>
	public static bool IsLocked(AssemblySlot slot) => slot.Shields.Count >= 2;

	/// <summary>Functional = not afflicted: counts toward the winning rack.</summary>
	public static bool IsFunctional(AssemblySlot slot) => slot.Afflictions.Count == 0;

	/// <summary>Completely clean: no afflictions AND no shields (the plague's only target).</summary>
	public static bool IsClean(AssemblySlot slot) => slot.Afflictions.Count == 0 && slot.Shields.Count == 0;

	/// <summary>
	/// The rack wins when its distinct FUNCTIONAL real colours plus its functional wild
	/// jokers (each fills one missing colour) reach the goal.
	/// </summary>
	public static bool HasWon(AssemblySeatState seat, AssemblyRulesConfig rules)
	{
		var functional = seat.Slots.Where(IsFunctional).Select(s => s.Color).ToList();
		var wilds = functional.Count(c => c == Wild);
		var distinctReal = functional.Where(c => c != Wild).Distinct().Count();
		return distinctReal + wilds >= rules.SlotsToWin;
	}

	public static AssemblySeatState SeatOf(AssemblyState state, string playerId)
		=> state.Seats.First(s => s.PlayerId == playerId);

	// ── Game construction ─────────────────────────────────────────────────────

	/// <summary>Expand the catalog into the physical deck (Count copies, stable instance
	/// ids), shuffle it through the game's randomness source (identity in E2E, keeping the
	/// cards.json order) and deal every player their opening hand.</summary>
	public static AssemblyState CreateInitialState(
		IEnumerable<string> playerIds,
		IReadOnlyList<AssemblyCardDef> deck,
		AssemblyRulesConfig rules,
		IRandomSource random)
	{
		var state = new AssemblyState
		{
			Seats = playerIds.Select(id => new AssemblySeatState { PlayerId = id }).ToList(),
			DrawPile = BuildShuffledPile(deck, random),
		};
		for (var n = 0; n < rules.HandSize; n++)
		{
			foreach (var seat in state.Seats)
			{
				if (state.DrawPile.Count > 0)
				{
					seat.Hand.Add(state.DrawPile[^1]);
					state.DrawPile.RemoveAt(state.DrawPile.Count - 1);
				}
			}
		}

		SyncCounts(state);
		return state;
	}

	private static List<AssemblyCardInstance> BuildShuffledPile(
		IReadOnlyList<AssemblyCardDef> deck, IRandomSource random)
	{
		var pile = new List<AssemblyCardInstance>();
		foreach (var def in deck)
		{
			for (var copy = 0; copy < Math.Max(1, def.Count); copy++)
			{
				pile.Add(new AssemblyCardInstance { InstanceId = $"{def.Id}#{copy}", CardId = def.Id });
			}
		}

		return random.Shuffle(pile).ToList();
	}

	/// <summary>Keep the projected counts (all a rival ever sees) in sync with the piles.</summary>
	public static void SyncCounts(AssemblyState state)
	{
		state.DrawCount = state.DrawPile.Count;
		state.DiscardCount = state.DiscardPile.Count;
		foreach (var seat in state.Seats)
		{
			seat.HandCount = seat.Hand.Count;
		}
	}

	// ── Legality ──────────────────────────────────────────────────────────────

	public sealed record PlayCheck(bool Ok, string? ReasonKey = null)
	{
		public static readonly PlayCheck Yes = new(true);
		public static PlayCheck No(string reasonKey) => new(false, reasonKey);
	}

	/// <summary>
	/// May this card be played with this targeting? Reasons are i18n keys, spoken as-is by
	/// the client refusal path. <paramref name="targetColor"/> names the slot on the target
	/// rack (attack / steal / swap) or on the OWN rack (remedy); <paramref name="giveColor"/>
	/// names the own slot offered in a swap.
	/// </summary>
	public static PlayCheck CanPlay(
		AssemblyCardDef card,
		AssemblySeatState seat,
		AssemblySeatState? target,
		string? targetColor,
		string? giveColor,
		AssemblyState state,
		IReadOnlyDictionary<string, AssemblyCardDef> catalog)
	{
		switch (card.Type)
		{
			case "piece":
				{
					// One slot per colour — a second wild joker is a duplicate too.
					var color = card.Color ?? Wild;
					return seat.Slots.Any(s => s.Color == color)
						? PlayCheck.No("game.assembly_color_taken")
						: PlayCheck.Yes;
				}

			case "attack":
				{
					if (target == null || target.PlayerId == seat.PlayerId)
					{
						return PlayCheck.No("game.assembly_needs_target");
					}

					var slot = SlotAt(target, targetColor);
					if (slot == null)
					{
						return PlayCheck.No("game.assembly_no_such_slot");
					}

					if (IsLocked(slot))
					{
						return PlayCheck.No("game.assembly_slot_locked");
					}

					if (!ColorMatches(card.Color, slot.Color))
					{
						return PlayCheck.No("game.assembly_color_mismatch");
					}

					return PlayCheck.Yes;
				}

			case "remedy":
				{
					var slot = SlotAt(seat, targetColor);
					if (slot == null)
					{
						return PlayCheck.No("game.assembly_no_such_slot");
					}

					if (IsLocked(slot))
					{
						return PlayCheck.No("game.assembly_already_locked");
					}

					if (!ColorMatches(card.Color, slot.Color))
					{
						return PlayCheck.No("game.assembly_color_mismatch");
					}

					return PlayCheck.Yes;
				}

			case "special":
				return CanPlaySpecial(card, seat, target, targetColor, giveColor, state, catalog);

			default:
				return PlayCheck.No("game.assembly_unknown_card");
		}
	}

	private static PlayCheck CanPlaySpecial(
		AssemblyCardDef card,
		AssemblySeatState seat,
		AssemblySeatState? target,
		string? targetColor,
		string? giveColor,
		AssemblyState state,
		IReadOnlyDictionary<string, AssemblyCardDef> catalog)
	{
		switch (card.SpecialKind)
		{
			case "swapPiece":
				{
					if (target == null || target.PlayerId == seat.PlayerId)
					{
						return PlayCheck.No("game.assembly_needs_target");
					}

					var mine = SlotAt(seat, giveColor);
					var theirs = SlotAt(target, targetColor);
					if (mine == null || theirs == null)
					{
						return PlayCheck.No("game.assembly_no_such_slot");
					}

					if (IsLocked(mine) || IsLocked(theirs))
					{
						return PlayCheck.No("game.assembly_slot_locked");
					}
					// After the swap neither rack may hold two slots of one colour.
					if (mine.Color != theirs.Color)
					{
						if (seat.Slots.Any(s => s != mine && s.Color == theirs.Color))
						{
							return PlayCheck.No("game.assembly_color_taken");
						}

						if (target.Slots.Any(s => s != theirs && s.Color == mine.Color))
						{
							return PlayCheck.No("game.assembly_color_taken_theirs");
						}
					}
					return PlayCheck.Yes;
				}

			case "stealPiece":
				{
					if (target == null || target.PlayerId == seat.PlayerId)
					{
						return PlayCheck.No("game.assembly_needs_target");
					}

					var theirs = SlotAt(target, targetColor);
					if (theirs == null)
					{
						return PlayCheck.No("game.assembly_no_such_slot");
					}

					if (IsLocked(theirs))
					{
						return PlayCheck.No("game.assembly_slot_locked");
					}

					if (seat.Slots.Any(s => s.Color == theirs.Color))
					{
						return PlayCheck.No("game.assembly_color_taken");
					}

					return PlayCheck.Yes;
				}

			case "plague":
				return PlagueMoves(seat, state, catalog).Count > 0
					? PlayCheck.Yes
					: PlayCheck.No("game.assembly_nothing_to_spread");

			case "scrapHands":
				return state.Seats.Any(s => s.PlayerId != seat.PlayerId && s.Hand.Count > 0)
					? PlayCheck.Yes
					: PlayCheck.No("game.assembly_no_hands_to_scrap");

			case "fullSwap":
				// A retired seat is not a target: its rack is gone, and "swapping" with an
				// empty ghost would be a donation to nobody. (The slot-targeted cards need
				// no guard — a retired seat has no slots to aim at.)
				return target == null || target.PlayerId == seat.PlayerId || target.Retired
					? PlayCheck.No("game.assembly_needs_target")
					: PlayCheck.Yes;

			default:
				return PlayCheck.No("game.assembly_unknown_card");
		}
	}

	private static AssemblySlot? SlotAt(AssemblySeatState seat, string? color)
		=> color == null ? null : seat.Slots.FirstOrDefault(s => s.Color == color);

	/// <summary>The NameKey of the piece sitting at a seat's colour slot (for the voice).</summary>
	private static string? PieceKeyAt(
		AssemblySeatState seat, string? color, IReadOnlyDictionary<string, AssemblyCardDef> catalog)
		=> SlotAt(seat, color) is { } slot ? catalog.GetValueOrDefault(slot.Piece.CardId)?.NameKey : null;

	/// <summary>
	/// Where the plague would move afflictions: each affliction on the caster's rack paired
	/// with the first CLEAN, colour-compatible rival slot (seat order, slot order) not
	/// already claimed by an earlier affliction. The affliction's colour is its attack
	/// card's (from the catalog). Deterministic on purpose: the same state resolves the
	/// same everywhere (server truth, client previews, bots).
	/// </summary>
	public static List<(AssemblySlot From, AssemblySeatState VictimSeat, AssemblySlot To)> PlagueMoves(
		AssemblySeatState seat, AssemblyState state, IReadOnlyDictionary<string, AssemblyCardDef> catalog)
	{
		var moves = new List<(AssemblySlot, AssemblySeatState, AssemblySlot)>();
		var claimed = new HashSet<AssemblySlot>();
		foreach (var mine in seat.Slots.Where(s => s.Afflictions.Count > 0))
		{
			var afflictionColor = catalog.GetValueOrDefault(mine.Afflictions[0].CardId)?.Color ?? Wild;
			foreach (var rival in state.Seats.Where(s => s.PlayerId != seat.PlayerId))
			{
				var to = rival.Slots.FirstOrDefault(s =>
					IsClean(s) && !claimed.Contains(s) && ColorMatches(afflictionColor, s.Color));
				if (to != null)
				{
					moves.Add((mine, rival, to));
					claimed.Add(to);
					break;
				}
			}
		}
		return moves;
	}

	// ── Turn actions (mutating; the flow layer validates whose turn it is) ────

	public sealed record PlayResult(
		bool Ok,
		string? ReasonKey = null,
		AssemblyCardDef? Card = null,
		/// <summary>The play completed the rack: the game is over.</summary>
		bool Won = false,
		/// <summary>Attacks only — what the hit did: "afflicted" (stuck to the piece),
		/// "destroyed" (second hit: the piece is gone) or "shieldBurned" (the shield took
		/// it). The voice tells the table how the victim's part ended up.</summary>
		string? AttackOutcome = null,
		/// <summary>Attacks only — the hit piece's NameKey (the client resolves it).</summary>
		string? AttackedPieceKey = null,
		/// <summary>Steal/swap specials — the piece TAKEN from the target (its NameKey). The
		/// picker auto-resolves single-option steps, so the voice must name what moved.</summary>
		string? TakenPieceKey = null,
		/// <summary>Swap special only — the piece the actor HANDED OVER (its NameKey).</summary>
		string? GivenPieceKey = null,
		/// <summary>Remedies only — what the medicine did: "cured" (removed an affliction),
		/// "shielded" (first protection) or "locked" (second: untouchable forever). The plain
		/// "plays a remedy" line said nothing, and locking a piece is a game-deciding event.</summary>
		string? RemedyOutcome = null,
		/// <summary>Remedies only — the treated piece's NameKey (the client resolves it).</summary>
		string? RemediedPieceKey = null);

	/// <summary>Play a card from the hand (authoritative re-check of legality).</summary>
	public static PlayResult Play(
		AssemblyState state,
		string playerId,
		string instanceId,
		string? targetPlayerId,
		string? targetColor,
		string? giveColor,
		AssemblyRulesConfig rules,
		IReadOnlyDictionary<string, AssemblyCardDef> catalog)
	{
		var seat = SeatOf(state, playerId);
		var instance = seat.Hand.FirstOrDefault(c => c.InstanceId == instanceId);
		if (instance == null)
		{
			return new PlayResult(false, "game.assembly_card_not_in_hand");
		}

		var card = catalog.GetValueOrDefault(instance.CardId);
		if (card == null)
		{
			return new PlayResult(false, "game.assembly_unknown_card");
		}

		var target = targetPlayerId == null ? null : state.Seats.FirstOrDefault(s => s.PlayerId == targetPlayerId);
		if (targetPlayerId != null && target == null)
		{
			return new PlayResult(false, "game.assembly_needs_target");
		}

		var check = CanPlay(card, seat, target, targetColor, giveColor, state, catalog);
		if (!check.Ok)
		{
			return new PlayResult(false, check.ReasonKey);
		}

		seat.Hand.Remove(instance);

		string? attackOutcome = null;
		string? attackedPieceKey = null;
		string? takenPieceKey = null;
		string? givenPieceKey = null;
		string? remedyOutcome = null;
		string? remediedPieceKey = null;
		switch (card.Type)
		{
			case "piece":
				seat.Slots.Add(new AssemblySlot { Color = card.Color ?? Wild, Piece = instance });
				break;

			case "attack":
				{
					var slot = SlotAt(target!, targetColor)!;
					attackedPieceKey = catalog.GetValueOrDefault(slot.Piece.CardId)?.NameKey;
					if (slot.Shields.Count == 1)
					{
						// The shield takes the hit: both burn.
						state.DiscardPile.Add(slot.Shields[0]);
						slot.Shields.Clear();
						state.DiscardPile.Add(instance);
						attackOutcome = "shieldBurned";
					}
					else if (slot.Afflictions.Count >= 1)
					{
						// Second hit: the piece is destroyed — piece and both attacks burn.
						target!.Slots.Remove(slot);
						state.DiscardPile.Add(slot.Piece);
						state.DiscardPile.AddRange(slot.Afflictions);
						state.DiscardPile.Add(instance);
						attackOutcome = "destroyed";
					}
					else
					{
						slot.Afflictions.Add(instance);
						attackOutcome = "afflicted";
					}
					break;
				}

			case "remedy":
				{
					var slot = SlotAt(seat, targetColor)!;
					remediedPieceKey = catalog.GetValueOrDefault(slot.Piece.CardId)?.NameKey;
					if (slot.Afflictions.Count > 0)
					{
						// The fix removes one affliction: both burn.
						state.DiscardPile.Add(slot.Afflictions[0]);
						slot.Afflictions.RemoveAt(0);
						state.DiscardPile.Add(instance);
						remedyOutcome = "cured";
					}
					else
					{
						slot.Shields.Add(instance); // first = shielded, second = locked
						remedyOutcome = IsLocked(slot) ? "locked" : "shielded";
					}
					break;
				}

			case "special":
				// Steal/swap: capture what moves BEFORE the slots change hands, so the
				// voice can name the pieces (the taken one, and for swaps the given one).
				if (card.SpecialKind is "stealPiece" or "swapPiece")
				{
					takenPieceKey = PieceKeyAt(target!, targetColor, catalog);
					if (card.SpecialKind == "swapPiece")
					{
						givenPieceKey = PieceKeyAt(seat, giveColor, catalog);
					}
				}
				ApplySpecial(card, seat, target, targetColor, giveColor, state, instance, catalog);
				break;
		}

		SyncCounts(state);
		return new PlayResult(true, Card: card, Won: HasWon(seat, rules),
			AttackOutcome: attackOutcome, AttackedPieceKey: attackedPieceKey,
			TakenPieceKey: takenPieceKey, GivenPieceKey: givenPieceKey,
			RemedyOutcome: remedyOutcome, RemediedPieceKey: remediedPieceKey);
	}

	private static void ApplySpecial(
		AssemblyCardDef card,
		AssemblySeatState seat,
		AssemblySeatState? target,
		string? targetColor,
		string? giveColor,
		AssemblyState state,
		AssemblyCardInstance instance,
		IReadOnlyDictionary<string, AssemblyCardDef> catalog)
	{
		switch (card.SpecialKind)
		{
			case "swapPiece":
				{
					var mine = seat.Slots.First(s => s.Color == giveColor);
					var theirs = target!.Slots.First(s => s.Color == targetColor);
					seat.Slots[seat.Slots.IndexOf(mine)] = theirs;
					target.Slots[target.Slots.IndexOf(theirs)] = mine;
					break;
				}

			case "stealPiece":
				{
					var theirs = target!.Slots.First(s => s.Color == targetColor);
					target.Slots.Remove(theirs);
					seat.Slots.Add(theirs);
					break;
				}

			case "plague":
				foreach (var (from, _, to) in PlagueMoves(seat, state, catalog))
				{
					to.Afflictions.Add(from.Afflictions[0]);
					from.Afflictions.RemoveAt(0);
				}
				break;

			case "scrapHands":
				foreach (var rival in state.Seats.Where(s => s.PlayerId != seat.PlayerId))
				{
					state.DiscardPile.AddRange(rival.Hand);
					rival.Hand.Clear();
				}
				break;

			case "fullSwap":
				{
					var mine = seat.Slots.ToList();
					var theirs = target!.Slots.ToList();
					seat.Slots.Clear(); seat.Slots.AddRange(theirs);
					target.Slots.Clear(); target.Slots.AddRange(mine);
					break;
				}
		}
		state.DiscardPile.Add(instance);
	}

	public sealed record DiscardResult(bool Ok, string? ReasonKey = null, int Count = 0);

	/// <summary>
	/// Discard 1..MaxDiscard cards face-down (the turn's alternative to playing). ZERO cards
	/// is the "pass": legal only with an empty hand (nothing to play or discard).
	/// </summary>
	public static DiscardResult Discard(AssemblyState state, string playerId,
		IReadOnlyList<string> instanceIds, AssemblyRulesConfig rules)
	{
		var seat = SeatOf(state, playerId);
		if (instanceIds.Count == 0)
		{
			return seat.Hand.Count == 0
				? new DiscardResult(true, Count: 0)
				: new DiscardResult(false, "game.assembly_must_act");
		}

		if (instanceIds.Count > rules.MaxDiscard)
		{
			return new DiscardResult(false, "game.assembly_discard_too_many");
		}

		if (instanceIds.Distinct().Count() != instanceIds.Count)
		{
			return new DiscardResult(false, "game.assembly_card_not_in_hand");
		}

		var instances = new List<AssemblyCardInstance>();
		foreach (var id in instanceIds)
		{
			var instance = seat.Hand.FirstOrDefault(c => c.InstanceId == id);
			if (instance == null)
			{
				return new DiscardResult(false, "game.assembly_card_not_in_hand");
			}

			instances.Add(instance);
		}
		foreach (var instance in instances)
		{
			seat.Hand.Remove(instance);
			state.DiscardPile.Add(instance);
		}
		SyncCounts(state);
		return new DiscardResult(true, Count: instances.Count);
	}

	/// <summary>
	/// Fold a leaver's seat (the shared leave-game flow): their hand AND their whole rack
	/// — pieces with everything stuck to them — go to the face-down discards, so the
	/// cards recirculate through the refill reshuffle instead of leaving the economy. The
	/// seat can no longer be targeted (no slots; fullSwap refuses it explicitly).
	/// </summary>
	public static void Retire(AssemblyState state, string playerId)
	{
		var seat = state.Seats.FirstOrDefault(s => s.PlayerId == playerId);
		if (seat == null || seat.Retired)
		{
			return;
		}

		seat.Retired = true;
		state.DiscardPile.AddRange(seat.Hand);
		seat.Hand.Clear();
		foreach (var slot in seat.Slots)
		{
			state.DiscardPile.Add(slot.Piece);
			state.DiscardPile.AddRange(slot.Afflictions);
			state.DiscardPile.AddRange(slot.Shields);
		}
		seat.Slots.Clear();
		SyncCounts(state);
	}

	/// <summary>
	/// End-of-turn refill: draw up to the hand size, reshuffling the face-down discards
	/// into a fresh pile when the draw pile dries (this genre never truly runs out unless
	/// every card sits on the racks). Returns the drawn instances for the private voice.
	/// </summary>
	public static List<AssemblyCardInstance> RefillHand(
		AssemblyState state, string playerId, AssemblyRulesConfig rules, IRandomSource random)
	{
		var seat = SeatOf(state, playerId);
		var drawn = new List<AssemblyCardInstance>();
		while (seat.Hand.Count < rules.HandSize)
		{
			if (state.DrawPile.Count == 0)
			{
				if (state.DiscardPile.Count == 0)
				{
					break;
				}

				var reshuffled = random.Shuffle(state.DiscardPile.ToList()).ToList();
				state.DiscardPile.Clear();
				state.DrawPile.AddRange(reshuffled);
			}
			var card = state.DrawPile[^1];
			state.DrawPile.RemoveAt(state.DrawPile.Count - 1);
			seat.Hand.Add(card);
			drawn.Add(card);
		}
		SyncCounts(state);
		return drawn;
	}
}
