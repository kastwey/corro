using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Bots;

/// <summary>
/// The draft bot (simultaneous pick-and-pass genre): a solid club player. It acts whenever
/// it holds cards and hasn't committed this trick — there is no turn in this family — and
/// never re-picks (its first choice stands). Decisions run over the bot's PROJECTED view:
/// it sees its own hand, every public table and the scores, exactly like a human.
///
/// The pick maximises immediate expected points: a points card (boosted when a multiplier
/// waits), the marginal step of a scale ladder, the completing card of a set (a partial
/// copy is worth a fraction), icons in the majority race, a multiplier while enough
/// tricks remain to cash it, and desserts weighted up as the game ages.
/// </summary>
public sealed class DraftBotPolicy : IBotPolicy
{
	public string GameType => "draft";

	public GameCommand? Decide(GameState view, string botId)
	{
		var draft = view.Draft;
		if (draft == null || view.IsGameOver)
		{
			return null;
		}

		var seat = draft.Seats.FirstOrDefault(s => s.PlayerId == botId);
		if (seat == null || seat.HasPicked || seat.Hand.Count == 0)
		{
			return null;
		}

		var catalog = DraftRulebook.Catalog(view.DraftDeck ?? new List<DraftCardDef>());
		var rules = view.DraftRules ?? new DraftRulesConfig();

		var ranked = seat.Hand
			.Select(instance => (Instance: instance, Def: catalog.GetValueOrDefault(instance.CardId)))
			.Where(x => x.Def != null)
			.OrderByDescending(x => Worth(x.Def!, seat, draft, rules, catalog))
			.ToList();
		if (ranked.Count == 0)
		{
			return null;
		}

		// An "extra" waiting on the table pays for a double: grab the two best cards.
		// The FIRST slot resolves first at the reveal, so a multiplier goes ahead of a
		// points card — that way the points land on it in the same trick.
		if (ranked.Count >= 2 && DraftRulebook.UnspentExtra(seat, catalog) != null)
		{
			var pair = ranked.Take(2).ToList();
			if (pair[1].Def!.Type == "multiplier" && pair[0].Def!.Type == "points")
			{
				(pair[0], pair[1]) = (pair[1], pair[0]);
			}

			return new DraftPickCommand
			{
				PlayerId = botId,
				InstanceId = pair[0].Instance.InstanceId,
				SecondInstanceId = pair[1].Instance.InstanceId,
			};
		}

		return new DraftPickCommand { PlayerId = botId, InstanceId = ranked[0].Instance.InstanceId };
	}

	/// <summary>Expected points from drafting this card right now (greedy, deterministic).</summary>
	private static double Worth(
		DraftCardDef def,
		DraftSeatState seat,
		DraftState draft,
		DraftRulesConfig rules,
		IReadOnlyDictionary<string, DraftCardDef> catalog)
	{
		int TableCopies(string cardId)
			=> seat.Table.Count(slot => slot.Card.CardId == cardId);

		switch (def.Type)
		{
			case "points":
				{
					var boost = seat.Table.Any(slot =>
						catalog.GetValueOrDefault(slot.Card.CardId)?.Type == "multiplier");
					return def.Value * (boost ? Math.Max(1, FirstFreeFactor()) : 1);

					int FirstFreeFactor()
						=> seat.Table
							.Select(slot => catalog.GetValueOrDefault(slot.Card.CardId))
							.FirstOrDefault(d => d?.Type == "multiplier")?.Factor ?? 1;
				}

			case "multiplier":
				// Only worth grabbing while enough tricks remain to land a card on it.
				return seat.Hand.Count >= 4 ? def.Factor + 1.5 : 0.5;

			case "set":
				{
					var have = TableCopies(def.Id);
					var completes = def.SetSize > 0 && (have + 1) % def.SetSize == 0;
					return completes
						? def.SetPoints
						: (double)def.SetPoints / Math.Max(2, def.SetSize);
				}

			case "scale":
				{
					if (def.Scale.Count == 0)
					{
						return 0;
					}

					var have = TableCopies(def.Id);
					var next = def.Scale[Math.Min(have + 1, def.Scale.Count) - 1];
					var current = have > 0 ? def.Scale[Math.Min(have, def.Scale.Count) - 1] : 0;
					return next - current;
				}

			case "majority":
				// Rough club heuristic: each icon is worth a share of the first prize.
				return def.Icons * (rules.MajorityFirst / 3.0);

			case "dessert":
				// Desserts pay at the very end: weight them up as the rounds pass.
				return 1.0 + draft.Round;

			case "extra":
				// A double pick later is strong — while enough tricks remain to spend it.
				return seat.Hand.Count >= 4 ? 3.0 : 0.5;

			default:
				return 0;
		}
	}
}
