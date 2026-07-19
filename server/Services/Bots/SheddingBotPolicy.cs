using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Bots;

/// <summary>
/// The shedding bot: a solid club player over its projected view. On its
/// turn: resolve a pending drawn-card pause by playing the card (it fits — that is why
/// the pause exists); otherwise shed the most expensive legal coloured card (dumping
/// points lowers the round risk), saving wilds for when nothing else fits; a wild names
/// the colour the hand holds most of. Nothing legal → draw.
/// </summary>
public sealed class SheddingBotPolicy : IBotPolicy
{
	public string GameType => "shedding";

	public GameCommand? Decide(GameState view, string botId)
	{
		var shedding = view.Shedding;
		if (shedding == null || view.IsGameOver)
		{
			return null;
		}

		if (view.CurrentTurn != botId)
		{
			return null;
		}

		var catalog = SheddingRulebook.Catalog(view.SheddingDeck ?? new List<SheddingCardDef>());
		var rules = view.SheddingRules ?? new SheddingRulesConfig();
		var seat = SheddingRulebook.SeatOf(shedding, botId);
		if (seat.Retired)
		{
			return null;
		}

		// Last-card rule: a rival played down to one card and hasn't declared — catch them
		// before taking our own turn (a separate pass then plays). Bots declare automatically,
		// so the exposed player is always a human who forgot.
		if (rules.LastCardCall && shedding.PendingLastCardCall is { } exposed && exposed != botId)
		{
			return new SheddingCatchLastCardCommand { PlayerId = botId };
		}

		// The drawn-card pause: the card fits (that's why the game paused) — play it.
		if (shedding.PendingDrawnPlay is { } pending && pending.PlayerId == botId)
		{
			var drawn = seat.Hand.FirstOrDefault(c => c.InstanceId == pending.InstanceId);
			var def = drawn != null ? catalog.GetValueOrDefault(drawn.CardId) : null;
			if (drawn == null || def == null)
			{
				return new SheddingKeepCommand { PlayerId = botId };
			}

			return Play(botId, drawn, def, seat, catalog);
		}

		var legal = seat.Hand
			.Select(instance => (Instance: instance, Def: catalog.GetValueOrDefault(instance.CardId)))
			.Where(x => x.Def != null
				&& SheddingRulebook.CanPlay(x.Def!, seat, shedding, rules, catalog).Ok)
			.ToList();
		if (legal.Count == 0)
		{
			return new SheddingDrawCommand { PlayerId = botId };
		}

		// Coloured cards first (most points first — shed the risk); wilds only when
		// nothing coloured fits (they rescue any later turn).
		var colored = legal.Where(x => x.Def!.Type is not ("wild" or "wildDrawFour"))
			.OrderByDescending(x => SheddingRulebook.PointsOf(x.Def!))
			.ToList();
		var pick = colored.Count > 0 ? colored[0] : legal[0];
		return Play(botId, pick.Instance, pick.Def!, seat, catalog);
	}

	private static SheddingPlayCommand Play(
		string botId,
		SheddingCardInstance instance,
		SheddingCardDef def,
		SheddingSeatState seat,
		IReadOnlyDictionary<string, SheddingCardDef> catalog)
		=> new()
		{
			PlayerId = botId,
			InstanceId = instance.InstanceId,
			ChosenColor = def.Type is "wild" or "wildDrawFour"
				? FavouriteColor(seat, catalog)
				: null,
		};

	/// <summary>The colour the hand holds most of (ties by deck order); any deck colour
	/// when the hand is all wilds.</summary>
	private static string FavouriteColor(
		SheddingSeatState seat, IReadOnlyDictionary<string, SheddingCardDef> catalog)
	{
		var colors = SheddingRulebook.DeckColors(catalog);
		var counts = seat.Hand
			.Select(i => catalog.GetValueOrDefault(i.CardId)?.Color)
			.Where(c => c != null)
			.GroupBy(c => c!)
			.ToDictionary(g => g.Key, g => g.Count());
		return colors.OrderByDescending(c => counts.GetValueOrDefault(c)).FirstOrDefault() ?? string.Empty;
	}
}
