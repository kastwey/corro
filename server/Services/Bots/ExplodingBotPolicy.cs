using CorroServer.Models;

namespace CorroServer.Services.Bots;

/// <summary>
/// The exploding bot, a straightforward v1 over its projected view
/// (the draw pile is a count, its order hidden — the bot cannot peek): on its turn it simply
/// draws to end the turn, taking its chances like everyone else; and when it draws a bomb it
/// holds a Defuse for, it tucks the bomb back a card or two down so the NEXT player meets it
/// soon. It does not (yet) play action cards or Nope out of turn — a later increment can grow
/// the brain without touching the driver.
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

		// A bomb the bot just defused: hide it a little way down to threaten the next player.
		if (exploding.PendingBomb is { } bomb && bomb.PlayerId == botId)
		{
			return new ExplodingDefuseCommand { PlayerId = botId, Depth = Math.Min(1, exploding.DrawCount) };
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
