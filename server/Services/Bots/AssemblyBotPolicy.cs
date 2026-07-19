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

		if (view.CurrentTurn != botId)
		{
			return null;
		}

		var catalog = AssemblyRulebook.Catalog(view.AssemblyDeck ?? new List<AssemblyCardDef>());
		var rules = view.AssemblyRules ?? new AssemblyRulesConfig();
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

		return new AssemblyDiscardCommand
		{
			PlayerId = botId,
			InstanceIds = new List<string> { ChooseDiscard(seat, assembly, rules, catalog, botId) },
		};
	}

	private sealed record Option(AssemblyCardInstance Instance, AssemblyCardDef Def,
		string? TargetPlayerId = null, string? TargetColor = null, string? GiveColor = null);

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

		// 1. FIX an afflicted slot (functionality back — possibly the winning move).
		foreach (var (instance, def) in handDefs.Where(x => x.Def.Type == "remedy"))
		{
			var afflicted = seat.Slots.FirstOrDefault(s =>
				s.Afflictions.Count > 0 && AssemblyRulebook.ColorMatches(def.Color, s.Color));
			if (afflicted != null && Legal(def, null, afflicted.Color, null))
			{
				return Play(instance, def, targetColor: afflicted.Color);
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
		foreach (var (instance, def) in handDefs.Where(x => x.Def.Type == "remedy"))
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
