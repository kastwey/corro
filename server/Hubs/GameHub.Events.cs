using CorroServer.Models;

namespace CorroServer.Hubs;

/// <summary>
/// GameHub partial: the one pure event helper that stayed on the Hub. The live event/persistence
/// wiring (SubscribeToGameEvents, the auction-timer callbacks, cleanup and the per-game persister)
/// moved to <see cref="GameSessionRegistry"/>, which owns the process-wide state.
/// </summary>
public partial class GameHub
{
	/// <summary>
	/// Renders one player's personalized view of an announcement batch: keeps the events
	/// whose audience reaches that player, in order. The actor receives the first-person
	/// (Player) lines and skips the third-person (AllExcept) duplicates; everyone else gets
	/// the opposite. Pure so it can be unit-tested without SignalR.
	/// </summary>
	internal static List<AnnouncementEvent> RenderBatchForPlayer(
		IReadOnlyList<AnnouncementDispatch> dispatches, string playerId)
	{
		var events = new List<AnnouncementEvent>(dispatches.Count);
		foreach (var dispatch in dispatches)
		{
			var include = dispatch.Audience switch
			{
				AnnouncementAudience.Player => dispatch.PlayerId == playerId,
				AnnouncementAudience.AllExcept => dispatch.PlayerId != playerId,
				_ => true // All
			};
			if (include)
			{
				events.Add(dispatch.Event);
			}
		}
		return events;
	}
}
