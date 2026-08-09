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

	/// <summary>Locked: two shields, or one POTENT remedy that sealed the piece by itself.
	/// Untouchable by attacks and specials, forever functional.</summary>
	public static bool IsLocked(AssemblySlot slot) => slot.Sealed || slot.Shields.Count >= 2;

	/// <summary>Functional = not afflicted: counts toward the winning rack. An inert piece
	/// never carries an affliction, so it is functional for as long as it is held.</summary>
	public static bool IsFunctional(AssemblySlot slot) => slot.Afflictions.Count == 0;

	/// <summary>Completely clean: no afflictions AND no shields (the plague's only target).</summary>
	public static bool IsClean(AssemblySlot slot) => slot.Afflictions.Count == 0 && slot.Shields.Count == 0;

	/// <summary>The affliction stuck to this slot cannot be lifted by an ORDINARY remedy: it
	/// takes a potent one (or an effect that removes it outright).</summary>
	public static bool HasResistantAffliction(
		AssemblySlot slot, IReadOnlyDictionary<string, AssemblyCardDef> catalog)
		=> slot.Afflictions.Count > 0
			&& catalog.GetValueOrDefault(slot.Afflictions[0].CardId)?.Resistant == true;

	/// <summary>How many colours this rack needs to win at this table (the duel house rule
	/// raises it by one when only two players sat down).</summary>
	public static int Goal(AssemblyState state, AssemblyRulesConfig rules)
		=> rules.GoalFor(state.Seats.Count);

	/// <summary>Distinct FUNCTIONAL real colours on a rack, plus its functional wild jokers
	/// (each of which fills one missing colour).</summary>
	public static int FunctionalColors(AssemblySeatState seat)
	{
		var functional = seat.Slots.Where(IsFunctional).Select(s => s.Color).ToList();
		return functional.Where(c => c != Wild).Distinct().Count() + functional.Count(c => c == Wild);
	}

	/// <summary>
	/// The rack wins when its distinct FUNCTIONAL real colours plus its functional wild
	/// jokers (each fills one missing colour) reach the table's goal.
	/// </summary>
	public static bool HasWon(AssemblyState state, AssemblySeatState seat, AssemblyRulesConfig rules)
		=> FunctionalColors(seat) >= Goal(state, rules);

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
		state.ExiledCount = state.ExiledPile.Count;
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

					if (slot.Inert)
					{
						return PlayCheck.No("game.assembly_piece_inert");
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

					if (slot.Inert)
					{
						return PlayCheck.No("game.assembly_piece_inert");
					}

					if (IsLocked(slot))
					{
						return PlayCheck.No("game.assembly_already_locked");
					}

					if (!ColorMatches(card.Color, slot.Color))
					{
						return PlayCheck.No("game.assembly_color_mismatch");
					}

					// A resistant affliction shrugs off ordinary treatment: only a potent
					// remedy lifts it (an exile special is the other way out).
					if (!card.Potent && HasResistantAffliction(slot, catalog))
					{
						return PlayCheck.No("game.assembly_affliction_resistant");
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

			case "exile":
				{
					// Lifts an affliction off ANY rack — your own included, which is usually
					// the point: it is the one cure that no resistance can shrug off.
					if (target == null)
					{
						return PlayCheck.No("game.assembly_needs_target");
					}

					var slot = SlotAt(target, targetColor);
					if (slot == null)
					{
						return PlayCheck.No("game.assembly_no_such_slot");
					}

					return slot.Afflictions.Count > 0
						? PlayCheck.Yes
						: PlayCheck.No("game.assembly_nothing_to_exile");
				}

			case "doubleAct":
				// Spends the turn buying the REST of the hand: worthless with nothing left.
				return seat.Hand.Count > 1
					? PlayCheck.Yes
					: PlayCheck.No("game.assembly_nothing_left_to_play");

			case "handSwap":
				// Legal against any live rival — even an empty hand is a trade worth making
				// (you hand them your leftovers and start again on theirs).
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
					IsClean(s) && !s.Inert && !claimed.Contains(s) && ColorMatches(afflictionColor, s.Color));
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
		string? RemediedPieceKey = null,
		/// <summary>Exile specials only — the NameKey of the piece the affliction was lifted
		/// off, so the voice can say whose part was cleared and by what.</summary>
		string? ExiledPieceKey = null,
		/// <summary>The play bought MORE plays this turn (doubleAct / handSwap): how many the
		/// player now owes before the turn ends. Zero means this card ended the turn.</summary>
		int ExtraPlays = 0);

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

		// This card settles one of the plays the turn owes (normally none: a plain turn is a
		// single card). Whatever it grants below is added on top of what is left.
		if (state.ExtraPlays > 0)
		{
			state.ExtraPlays--;
		}

		string? attackOutcome = null;
		string? attackedPieceKey = null;
		string? takenPieceKey = null;
		string? givenPieceKey = null;
		string? remedyOutcome = null;
		string? remediedPieceKey = null;
		string? exiledPieceKey = null;
		switch (card.Type)
		{
			case "piece":
				seat.Slots.Add(new AssemblySlot
				{
					Color = card.Color ?? Wild,
					Piece = instance,
					Inert = card.Inert,
				});
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
						// The fix removes one affliction: the remedy always burns, and the
						// attack burns with it — unless attrition is on and the remedy was
						// potent, which takes that attack out of the game for good.
						var lifted = slot.Afflictions[0];
						slot.Afflictions.RemoveAt(0);
						if (rules.AttritionCures && card.Potent)
						{
							state.ExiledPile.Add(lifted);
						}
						else
						{
							state.DiscardPile.Add(lifted);
						}

						state.DiscardPile.Add(instance);
						remedyOutcome = "cured";
					}
					else
					{
						slot.Shields.Add(instance);
						if (card.Potent)
						{
							// A potent remedy seals the piece on its own — no second shield.
							slot.Sealed = true;
							remedyOutcome = "sealed";
						}
						else
						{
							remedyOutcome = IsLocked(slot) ? "locked" : "shielded"; // first, then second
						}
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
				else if (card.SpecialKind == "exile")
				{
					exiledPieceKey = PieceKeyAt(target!, targetColor, catalog);
				}

				ApplySpecial(card, seat, target, targetColor, giveColor, state, instance, catalog);
				break;
		}

		SyncCounts(state);
		return new PlayResult(true, Card: card, Won: HasWon(state, seat, rules),
			AttackOutcome: attackOutcome, AttackedPieceKey: attackedPieceKey,
			TakenPieceKey: takenPieceKey, GivenPieceKey: givenPieceKey,
			RemedyOutcome: remedyOutcome, RemediedPieceKey: remediedPieceKey,
			ExiledPieceKey: exiledPieceKey, ExtraPlays: state.ExtraPlays);
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

			case "exile":
				{
					// The affliction leaves the game entirely — it never comes back through
					// the refill reshuffle, unlike everything on the discards.
					var slot = target!.Slots.First(s => s.Color == targetColor);
					state.ExiledPile.Add(slot.Afflictions[0]);
					slot.Afflictions.RemoveAt(0);
					break;
				}

			case "doubleAct":
				// Buy the rest of the hand instead of ending the turn on this card.
				state.ExtraPlays += seat.Hand.Count;
				break;

			case "handSwap":
				{
					// Trade hands, then play ONE of the cards you received. They are not
					// yours to throw away, so the turn's discard option closes.
					var mine = seat.Hand.ToList();
					var theirs = target!.Hand.ToList();
					seat.Hand.Clear(); seat.Hand.AddRange(theirs);
					target.Hand.Clear(); target.Hand.AddRange(mine);
					state.ExtraPlays += 1;
					state.DiscardBlocked = true;
					break;
				}
		}
		state.DiscardPile.Add(instance);
	}

	/// <summary>One fully-specified way to play a card: who it is aimed at, which of their
	/// slots, and (swaps only) which of mine goes the other way.</summary>
	public sealed record Targeting(string? TargetPlayerId, string? TargetColor, string? GiveColor);

	/// <summary>
	/// Every legal way to play this card right now, each one re-checked through
	/// <see cref="CanPlay"/> so this can never drift from the authoritative legality. The
	/// pickers, the bots and the "can this turn continue?" check all read the same list.
	/// </summary>
	public static List<Targeting> LegalTargetings(
		AssemblyCardDef card,
		AssemblySeatState seat,
		AssemblyState state,
		IReadOnlyDictionary<string, AssemblyCardDef> catalog)
	{
		var rivals = state.Seats.Where(s => s.PlayerId != seat.PlayerId).ToList();
		var candidates = new List<Targeting>();

		switch (card.Type)
		{
			case "piece":
				candidates.Add(new Targeting(null, null, null));
				break;

			case "attack":
				candidates.AddRange(from rival in rivals
									from slot in rival.Slots
									select new Targeting(rival.PlayerId, slot.Color, null));
				break;

			case "remedy":
				candidates.AddRange(seat.Slots.Select(slot => new Targeting(seat.PlayerId, slot.Color, null)));
				break;

			case "special":
				switch (card.SpecialKind)
				{
					case "swapPiece":
						candidates.AddRange(from rival in rivals
											from theirs in rival.Slots
											from mine in seat.Slots
											select new Targeting(rival.PlayerId, theirs.Color, mine.Color));
						break;
					case "stealPiece":
						candidates.AddRange(from rival in rivals
											from slot in rival.Slots
											select new Targeting(rival.PlayerId, slot.Color, null));
						break;
					case "exile":
						// Own rack included: clearing your own resistant affliction is the
						// commonest use of the card.
						candidates.AddRange(from any in state.Seats
											from slot in any.Slots
											select new Targeting(any.PlayerId, slot.Color, null));
						break;
					case "fullSwap" or "handSwap":
						candidates.AddRange(rivals.Select(rival => new Targeting(rival.PlayerId, null, null)));
						break;
					default:
						candidates.Add(new Targeting(null, null, null));
						break;
				}
				break;
		}

		return candidates
			.Where(t =>
			{
				var target = t.TargetPlayerId == null
					? null
					: state.Seats.FirstOrDefault(s => s.PlayerId == t.TargetPlayerId);
				return CanPlay(card, seat, target, t.TargetColor, t.GiveColor, state, catalog).Ok;
			})
			.ToList();
	}

	/// <summary>Could this player play ANY card in hand right now? An extended turn ends the
	/// moment the answer is no, so a granted play the hand cannot spend never wedges the table.</summary>
	public static bool HasAnyLegalPlay(
		AssemblyState state, string playerId,
		IReadOnlyDictionary<string, AssemblyCardDef> catalog)
	{
		var seat = SeatOf(state, playerId);
		return seat.Hand.Any(instance =>
			catalog.GetValueOrDefault(instance.CardId) is { } card
			&& LegalTargetings(card, seat, state, catalog).Count > 0);
	}

	/// <summary>The turn is over: the plays it owed and the borrowed-hand discard block are
	/// personal to it and never survive into the next player's turn.</summary>
	public static void ClearTurnGrants(AssemblyState state)
	{
		state.ExtraPlays = 0;
		state.DiscardBlocked = false;
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
			// An empty hand always passes; so does a borrowed one with nothing playable left,
			// which would otherwise have no way to end its turn.
			return seat.Hand.Count == 0 || state.ExtraPlays > 0
				? new DiscardResult(true, Count: 0)
				: new DiscardResult(false, "game.assembly_must_act");
		}

		// Cards taken from someone else's hand are to be PLAYED, not thrown away.
		if (state.DiscardBlocked)
		{
			return new DiscardResult(false, "game.assembly_discard_blocked");
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
