using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Bots;

/// <summary>
/// The exploding bot, a straightforward v1 over its projected view
/// (the draw pile is a count, its order hidden — the bot cannot peek): on its turn it simply
/// draws to end the turn, taking its chances like everyone else; when it draws a bomb it holds
/// a Defuse for, it tucks the bomb into the middle of the remaining pile;
/// and when another player asks it for a Favor, it gives a card while preserving a Defuse when
/// possible. It does not (yet) play action cards or Nope out of turn — a later increment can
/// grow the brain without touching the driver.
/// </summary>
public sealed class ExplodingBotPolicy : IBotPolicy
{
	public string GameType => "exploding";

	public GameCommand? Decide(GameState view, string botId)
	{
		var exploding = view.Exploding;
		if (exploding == null || view.IsGameOver)
		{
			return null;
		}

		var seat = exploding.Seats.FirstOrDefault(s => s.PlayerId == botId);
		if (seat == null || seat.Retired)
		{
			return null;
		}

		// Use the same midpoint offered to human players. Keeping it near the top made the
		// bot predictably meet its own bomb again on the next rotation.
		if (exploding.PendingBomb is { } bomb && bomb.PlayerId == botId)
		{
			return new ExplodingDefuseCommand { PlayerId = botId, Depth = exploding.DrawCount / 2 };
		}

		// A Favor freezes the table and belongs to its target, even though it is still the
		// requester's turn. Answer mine; while somebody else must answer, wait.
		if (exploding.PendingFavor is { } favor)
		{
			if (favor.TargetId != botId || seat.Hand.Count == 0)
			{
				return null;
			}

			// A Defuse is the one unambiguously life-saving card. Give the first other card
			// from the projected hand; if every card is a Defuse, the Favor still has to be paid.
			var catalog = ExplodingRulebook.Catalog(view.ExplodingDeck ?? new());
			var card = seat.Hand.FirstOrDefault(instance =>
				!ExplodingRulebook.IsDefuse(catalog.GetValueOrDefault(instance.CardId))) ?? seat.Hand[0];
			return new ExplodingGiveCommand { PlayerId = botId, InstanceId = card.InstanceId };
		}

		if (view.CurrentTurn != botId)
		{
			return null; // the v1 bot does not Nope out of turn
		}

		if (exploding.PendingAction != null)
		{
			return null; // let the open window resolve
		}

		return new ExplodingDrawCommand { PlayerId = botId }; // take the turn by drawing
	}
}
