using CorroServer.Models;

namespace CorroServer.Services.Bots;

/// <summary>
/// The track bot: the family is roll-and-resolve with no choices at all, so the whole
/// brain is "roll when it is my turn". Roll-again on the top face keeps the turn with the
/// bot, and the next state change drives the next roll.
/// </summary>
public sealed class TrackBotPolicy : IBotPolicy
{
	public string GameType => "track";

	public GameCommand? Decide(GameState view, string botId)
		=> !view.IsGameOver && view.CurrentTurn == botId
			? new RollDiceCommand { PlayerId = botId }
			: null;
}
