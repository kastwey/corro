using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Bots;

/// <summary>
/// The journey bot: a solid club player, not a shark. Decisions run over the bot's
/// PROJECTED view (its own hand, everyone's public table state) and re-use the pure
/// <see cref="JourneyRulebook"/> legality — so the bot obeys the game's EFFECTIVE rules
/// (goal, stacking, limits… whatever the package and the lobby chose) by construction.
///
/// Turn shape: accept every coup fourré (officially always profitable), draw when due,
/// then play in this order — finish the trip exactly, get rolling again, best distance,
/// lift a speed limit, attack the leading rival seat, bank an immunity — and discard the
/// least useful card when nothing is playable. Immunities are held for the coup chance
/// until there is nothing better to do.
/// </summary>
public sealed class JourneyBotPolicy : IBotPolicy
{
	public string GameType => "journey";

	public GameCommand? Decide(GameState view, string botId)
	{
		var journey = view.Journey;
		if (journey == null || view.IsGameOver)
		{
			return null;
		}

		// The coup fourré interrupt is the bot's decision even OUT of turn.
		if (journey.PendingCoup is { } coup)
		{
			return coup.VictimId == botId
				? new JourneyCoupCommand { PlayerId = botId, Accept = true }
				: null; // someone else's decision: wait
		}

		if (view.CurrentTurn != botId)
		{
			return null;
		}

		// The classic turn shape: draw first while the pile has cards.
		if (!journey.HasDrawn && journey.DrawCount > 0)
		{
			return new JourneyDrawCommand { PlayerId = botId };
		}

		var catalog = JourneyRulebook.Catalog(view.JourneyDeck ?? new List<JourneyCardDef>());
		var rules = view.JourneyRules ?? new JourneyRulesConfig();
		var seat = JourneyRulebook.SeatOf(journey, botId);
		var hand = JourneyRulebook.MemberOf(journey, botId).Hand;
		if (hand.Count == 0)
		{
			return null; // the turn flow skips cardless players aloud
		}

		var play = ChoosePlay(journey, seat, hand, rules, catalog, botId);
		if (play != null)
		{
			return play;
		}

		// Nothing playable: discard the least useful card.
		return new JourneyDiscardCommand { PlayerId = botId, InstanceId = ChooseDiscard(hand, seat, rules, catalog) };
	}

	private static JourneyPlayCommand? ChoosePlay(
		JourneyState journey,
		JourneySeatState seat,
		IReadOnlyList<JourneyCardInstance> hand,
		JourneyRulesConfig rules,
		IReadOnlyDictionary<string, JourneyCardDef> catalog,
		string botId)
	{
		// Every legal (card, target) option, evaluated once.
		var options = new List<(JourneyCardInstance Instance, JourneyCardDef Def, string? TargetId)>();
		foreach (var instance in hand)
		{
			var def = catalog.GetValueOrDefault(instance.CardId);
			if (def == null)
			{
				continue;
			}

			if (def.Type == "attack")
			{
				// The best victim: the attackable rival SEAT with the most kilometres.
				var victim = journey.Seats
					.Where(s => s != seat)
					.Where(s => JourneyRulebook.CanPlay(def, seat, s, rules, catalog).Ok)
					.OrderByDescending(s => s.Km)
					.FirstOrDefault();
				if (victim != null)
				{
					options.Add((instance, def, victim.PlayerId));
				}
			}
			else if (JourneyRulebook.CanPlay(def, seat, null, rules, catalog).Ok)
			{
				options.Add((instance, def, null));
			}
		}
		if (options.Count == 0)
		{
			return null;
		}

		// 1. Land EXACTLY on the goal: the hand is won.
		var finish = options.FirstOrDefault(o => o.Def.Type == "distance" && seat.Km + o.Def.Value == rules.GoalKm);
		// 2. Get rolling again: a remedy that cures a STOPPER (the green light included).
		var restart = options.FirstOrDefault(o => o.Def.Type == "remedy" && CuresStopper(o.Def, catalog));
		// 3. Advance: the biggest legal distance.
		var distance = options.Where(o => o.Def.Type == "distance").OrderByDescending(o => o.Def.Value).FirstOrDefault();
		// 4. Lift a limiter (end of limit) so future turns advance faster.
		var lift = options.FirstOrDefault(o => o.Def.Type == "remedy");
		// 5. Slow the leader down.
		var attack = options.FirstOrDefault(o => o.Def.Type == "attack");
		// 6. Nothing better: bank an immunity (held until now for the coup fourré chance).
		var immunity = options.FirstOrDefault(o => o.Def.Type == "immunity");

		var chosen = Pick(finish) ?? Pick(restart) ?? Pick(distance) ?? Pick(lift) ?? Pick(attack) ?? Pick(immunity);
		return chosen is { } c
			? new JourneyPlayCommand { PlayerId = botId, InstanceId = c.Instance.InstanceId, TargetId = c.TargetId }
			: null;

		static (JourneyCardInstance Instance, JourneyCardDef Def, string? TargetId)? Pick(
			(JourneyCardInstance Instance, JourneyCardDef Def, string? TargetId) option)
			=> option.Instance == null ? null : option;
	}

	private static bool CuresStopper(JourneyCardDef remedy, IReadOnlyDictionary<string, JourneyCardDef> catalog)
	{
		// A remedy cures a stopper when its kind is inflicted by a stopper attack — or when
		// no attack inflicts it at all (the initial hazard's own remedy, the green light).
		var attack = catalog.Values.FirstOrDefault(c => c.Type == "attack" && c.Kind == remedy.Kind);
		return attack == null || attack.HazardClass == "stopper";
	}

	/// <summary>The least useful card: an unplayable duplicate first, then the unplayable
	/// card of least value, never an immunity while anything else remains.</summary>
	private static string ChooseDiscard(
		IReadOnlyList<JourneyCardInstance> hand,
		JourneySeatState seat,
		JourneyRulesConfig rules,
		IReadOnlyDictionary<string, JourneyCardDef> catalog)
	{
		var candidates = hand
			.Select(i => (Instance: i, Def: catalog.GetValueOrDefault(i.CardId)))
			.Where(x => x.Def != null && x.Def!.Type != "immunity")
			.OrderByDescending(x => hand.Count(other => other.CardId == x.Instance.CardId)) // duplicates first
			.ThenBy(x => x.Def!.Value)
			.ToList();
		return (candidates.Count > 0 ? candidates[0].Instance : hand[0]).InstanceId;
	}
}
