using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Bots;

/// <summary>
/// The assembly bot: a solid club player. Decisions run over the bot's
/// PROJECTED view and re-use the pure <see cref="AssemblyRulebook"/> legality, so the bot
/// obeys the game's effective rules by construction.
///
/// Play order: fix an afflicted slot (keeps the rack functional — and may win), install a
/// new piece, steal a colour it lacks, attack the leading rival (their afflicted slot
/// first: the destruction), shield/lock own slots, dump afflictions with the plague, scrap
/// hands, rescue an afflicted slot through a swap, grab a better rack with the full swap —
/// and discard the least useful card when nothing is playable (pass with an empty hand).
/// </summary>
public sealed class AssemblyBotPolicy : IBotPolicy
{
	public string GameType => "assembly";

	public GameCommand? Decide(GameState view, string botId)
	{
		var assembly = view.Assembly;
		if (assembly == null || view.IsGameOver)
		{
			return null;
		}

		var catalog = AssemblyRulebook.Catalog(view.AssemblyDeck ?? new List<AssemblyCardDef>());
		var rules = view.AssemblyRules ?? new AssemblyRulesConfig();

		// A card hanging over the table freezes the turn, so answering it comes BEFORE the
		// turn check: the bot being asked is usually not the one whose turn it is, and a bot
		// that never answered would leave the table waiting for it forever.
		if (assembly.PendingPlay is { } pending)
		{
			if (AssemblyRulebook.AwaitedShieldFrom(assembly) == botId)
			{
				return new AssemblyGuardCommand
				{
					PlayerId = botId,
					InstanceId = WorthShielding(assembly, pending, botId, catalog)
						? ShieldInHand(assembly, botId, catalog)
						: null,
				};
			}

			if (pending.AwaitingRetarget && pending.ActorId == botId)
			{
				return ChooseNewVictim(assembly, botId, catalog);
			}

			return null; // somebody else owes the answer
		}

		if (view.CurrentTurn != botId)
		{
			return null;
		}

		var seat = AssemblyRulebook.SeatOf(assembly, botId);

		if (seat.Hand.Count == 0)
		{
			return new AssemblyDiscardCommand { PlayerId = botId, InstanceIds = new List<string>() }; // the pass
		}

		var play = ChoosePlay(assembly, seat, rules, catalog, botId);
		if (play != null)
		{
			return play;
		}

		// A borrowed hand may not be thrown away: with nothing left to play, the only way out
		// of the turn is the pass. Discarding here would be refused on every retry.
		if (assembly.DiscardBlocked)
		{
			return new AssemblyDiscardCommand { PlayerId = botId, InstanceIds = new List<string>() };
		}

		return new AssemblyDiscardCommand
		{
			PlayerId = botId,
			InstanceIds = new List<string> { ChooseDiscard(seat, assembly, rules, catalog, botId) },
		};
	}

	private sealed record Option(AssemblyCardInstance Instance, AssemblyCardDef Def,
		string? TargetPlayerId = null, string? TargetColor = null, string? GiveColor = null);

	// ── Answering somebody else's card ────────────────────────────────────────

	private static string? ShieldInHand(
		AssemblyState assembly, string botId, IReadOnlyDictionary<string, AssemblyCardDef> catalog)
		=> AssemblyRulebook.SeatOf(assembly, botId).Hand
			.FirstOrDefault(i => catalog.GetValueOrDefault(i.CardId)?.SpecialKind == "guard")?.InstanceId;

	/// <summary>
	/// Is this card worth a shield? A shield is scarce, so it is kept for damage that would
	/// actually cost something: a hit that sticks (rather than one an existing protection would
	/// absorb), anything that takes a piece or a hand away, and a table-wide effect with
	/// something of the bot's to ruin.
	/// </summary>
	private static bool WorthShielding(
		AssemblyState assembly, PendingAssemblyPlay pending, string botId,
		IReadOnlyDictionary<string, AssemblyCardDef> catalog)
	{
		var card = catalog.GetValueOrDefault(pending.CardId);
		if (card == null)
		{
			return false;
		}

		var seat = AssemblyRulebook.SeatOf(assembly, botId);
		switch (card.SpecialKind)
		{
			case "scrapHands":
				// Only worth it if the shield saves more than itself.
				return seat.Hand.Count > 2;
			case "plague":
				return seat.Slots.Any(s => AssemblyRulebook.IsClean(s) && !s.Inert);
			case "stealPiece" or "swapPiece" or "fullSwap" or "handSwap":
				return true;
		}

		if (card.Type != "attack")
		{
			return false;
		}

		// A protected piece would merely lose its protection; a bare one takes real damage,
		// and an already damaged one is about to be destroyed outright.
		var slot = seat.Slots.FirstOrDefault(s => s.Color == pending.TargetColor);
		return slot != null && slot.Shields.Count == 0;
	}

	/// <summary>A shield sent the bot's own card looking for a new victim: aim it at the
	/// strongest rack it can still reach, and only at the bot's own as a last resort.</summary>
	private static AssemblyRetargetCommand? ChooseNewVictim(
		AssemblyState assembly, string botId, IReadOnlyDictionary<string, AssemblyCardDef> catalog)
	{
		var options = AssemblyRulebook.RetargetOptions(assembly, catalog);
		if (options.Count == 0)
		{
			return null; // the server bins the card on its own
		}

		var best = options
			.OrderBy(t => t.TargetPlayerId == botId ? 1 : 0) // never volunteer my own rack
			.ThenByDescending(t => t.TargetPlayerId is { } id
				&& assembly.Seats.FirstOrDefault(s => s.PlayerId == id) is { } victim
				? AssemblyRulebook.FunctionalColors(victim)
				: 0)
			.First();

		return new AssemblyRetargetCommand
		{
			PlayerId = botId,
			TargetPlayerId = best.TargetPlayerId,
			TargetColor = best.TargetColor,
			GiveColor = best.GiveColor,
		};
	}

	private AssemblyPlayCommand? ChoosePlay(
		AssemblyState assembly,
		AssemblySeatState seat,
		AssemblyRulesConfig rules,
		IReadOnlyDictionary<string, AssemblyCardDef> catalog,
		string botId)
	{
		bool Legal(AssemblyCardDef def, AssemblySeatState? target, string? targetColor, string? giveColor)
			=> AssemblyRulebook.CanPlay(def, seat, target, targetColor, giveColor, assembly, catalog).Ok;

		int Functional(AssemblySeatState s)
		{
			var functional = s.Slots.Where(AssemblyRulebook.IsFunctional).Select(x => x.Color).ToList();
			return functional.Where(c => c != AssemblyRulebook.Wild).Distinct().Count()
				+ functional.Count(c => c == AssemblyRulebook.Wild);
		}

		var rivals = assembly.Seats.Where(s => s.PlayerId != botId).ToList();
		var leaderFirst = rivals.OrderByDescending(Functional).ToList();
		var handDefs = seat.Hand
			.Select(i => (Instance: i, Def: catalog.GetValueOrDefault(i.CardId)))
			.Where(x => x.Def != null)
			.Select(x => (x.Instance, Def: x.Def!))
			.ToList();

		// 0. BUY THE REST OF THE TURN, while there is still a turn worth buying: only when at
		// least two OTHER cards can actually be played, so the plays it grants are not spent
		// on a hand that has nothing to do with them.
		foreach (var (instance, def) in handDefs.Where(x => x.Def.SpecialKind == "doubleAct"))
		{
			var playableOthers = handDefs.Count(other =>
				other.Instance.InstanceId != instance.InstanceId
				&& AssemblyRulebook.LegalTargetings(other.Def, seat, assembly, catalog).Count > 0);
			if (playableOthers >= 2 && Legal(def, null, null, null))
			{
				return Play(instance, def);
			}
		}

		// Remedies are spent weakest-first: a POTENT one is the only answer to a resistant
		// affliction and seals a piece by itself, so it is never burnt on work an ordinary
		// remedy could have done.
		var remedies = handDefs.Where(x => x.Def.Type == "remedy")
			.OrderBy(x => x.Def.Potent ? 1 : 0).ToList();

		// 1. FIX an afflicted slot (functionality back — possibly the winning move).
		foreach (var (instance, def) in remedies)
		{
			var afflicted = seat.Slots.FirstOrDefault(s =>
				s.Afflictions.Count > 0 && AssemblyRulebook.ColorMatches(def.Color, s.Color));
			if (afflicted != null && Legal(def, null, afflicted.Color, null))
			{
				return Play(instance, def, targetColor: afflicted.Color);
			}
		}

		// 1b. EXILE an affliction off my OWN rack — the one cure nothing can resist. Aimed at
		// a resistant affliction first, since an ordinary one has cheaper answers.
		foreach (var (instance, def) in handDefs.Where(x => x.Def.SpecialKind == "exile"))
		{
			var stuck = seat.Slots
				.Where(s => s.Afflictions.Count > 0)
				.OrderByDescending(s => AssemblyRulebook.HasResistantAffliction(s, catalog) ? 1 : 0)
				.FirstOrDefault(s => Legal(def, seat, s.Color, null));
			if (stuck != null)
			{
				return Play(instance, def, seat.PlayerId, stuck.Color);
			}
		}

		// 2. INSTALL a new piece.
		foreach (var (instance, def) in handDefs.Where(x => x.Def.Type == "piece"))
		{
			if (Legal(def, null, null, null))
			{
				return Play(instance, def);
			}
		}

		// 3. STEAL a colour the rack lacks (leader first).
		foreach (var (instance, def) in handDefs.Where(x => x.Def.SpecialKind == "stealPiece"))
		{
			foreach (var rival in leaderFirst)
			{
				foreach (var slot in rival.Slots)
				{
					if (Legal(def, rival, slot.Color, null))
					{
						return Play(instance, def, rival.PlayerId, slot.Color);
					}
				}
			}
		}

		// 4. ATTACK the leader — their afflicted slot first (the destruction), then any.
		foreach (var (instance, def) in handDefs.Where(x => x.Def.Type == "attack"))
		{
			foreach (var rival in leaderFirst)
			{
				var slot = rival.Slots
					.Where(s => Legal(def, rival, s.Color, null))
					.OrderByDescending(s => s.Afflictions.Count)   // destroy over afflict
					.ThenBy(s => s.Shields.Count)                  // avoid wasting on shields
					.FirstOrDefault();
				if (slot != null)
				{
					return Play(instance, def, rival.PlayerId, slot.Color);
				}
			}
		}

		// 5. SHIELD / LOCK own slots (lock a shielded one first: untouchable forever).
		foreach (var (instance, def) in remedies)
		{
			var slot = seat.Slots
				.Where(s => AssemblyRulebook.IsFunctional(s) && !AssemblyRulebook.IsLocked(s))
				.Where(s => Legal(def, null, s.Color, null))
				.OrderByDescending(s => s.Shields.Count)
				.FirstOrDefault();
			if (slot != null)
			{
				return Play(instance, def, targetColor: slot.Color);
			}
		}

		// 6. PLAGUE my afflictions away; 7. SCRAP the table's hands.
		foreach (var (instance, def) in handDefs.Where(x => x.Def.SpecialKind is "plague" or "scrapHands"))
		{
			if (Legal(def, null, null, null))
			{
				return Play(instance, def);
			}
		}

		// 8. SWAP an afflicted slot of mine for a functional rival slot (state travels).
		foreach (var (instance, def) in handDefs.Where(x => x.Def.SpecialKind == "swapPiece"))
		{
			foreach (var mine in seat.Slots.Where(s => s.Afflictions.Count > 0))
			{
				foreach (var rival in leaderFirst)
				{
					foreach (var theirs in rival.Slots.Where(AssemblyRulebook.IsFunctional))
					{
						if (Legal(def, rival, theirs.Color, mine.Color))
						{
							return Play(instance, def, rival.PlayerId, theirs.Color, mine.Color);
						}
					}
				}
			}
		}

		// 9. FULL SWAP into a strictly better rack.
		foreach (var (instance, def) in handDefs.Where(x => x.Def.SpecialKind == "fullSwap"))
		{
			var better = leaderFirst.FirstOrDefault(r => Functional(r) > Functional(seat));
			if (better != null && Legal(def, better, null, null))
			{
				return Play(instance, def, better.PlayerId);
			}
		}

		// 10. TRADE HANDS as the last resort: this hand had nothing to offer, so someone
		// else's is worth the gamble — better than throwing cards away for nothing.
		foreach (var (instance, def) in handDefs.Where(x => x.Def.SpecialKind == "handSwap"))
		{
			var richest = leaderFirst.OrderByDescending(r => r.HandCount).FirstOrDefault();
			if (richest != null && Legal(def, richest, null, null))
			{
				return Play(instance, def, richest.PlayerId);
			}
		}

		return null;

		AssemblyPlayCommand Play(AssemblyCardInstance instance, AssemblyCardDef def,
			string? targetPlayerId = null, string? targetColor = null, string? giveColor = null)
			=> new()
			{
				PlayerId = botId,
				InstanceId = instance.InstanceId,
				TargetPlayerId = targetPlayerId,
				TargetColor = targetColor,
				GiveColor = giveColor,
			};
	}

	/// <summary>The least useful card: an unplayable one first (duplicates ahead), never a
	/// piece while anything else remains.</summary>
	private static string ChooseDiscard(
		AssemblySeatState seat,
		AssemblyState assembly,
		AssemblyRulesConfig rules,
		IReadOnlyDictionary<string, AssemblyCardDef> catalog,
		string botId)
	{
		_ = rules; _ = botId;
		var candidates = seat.Hand
			.Select(i => (Instance: i, Def: catalog.GetValueOrDefault(i.CardId)))
			.Where(x => x.Def != null)
			.OrderBy(x => x.Def!.Type == "piece" ? 1 : 0) // keep pieces for last
			.ThenByDescending(x => seat.Hand.Count(other => other.CardId == x.Instance.CardId))
			.ToList();
		return (candidates.Count > 0 ? candidates[0].Instance : seat.Hand[0]).InstanceId;
	}
}
