using CorroServer.Models;

namespace CorroServer.Services.Corro.Families;

/// <summary>
/// Plans how a state update reaches a game's clients. Families without hidden information
/// broadcast one state to the whole game group (null plan — the caller keeps the single group
/// send). A hidden-information family gets a per-player plan: each player's connections receive
/// THEIR projection, and connections not mapped to a player (never authenticated) receive
/// nothing, because the whole state would leak hands and deck order.
/// </summary>
public static class GameStateFanout
{
	public sealed record Send(IReadOnlyList<string> ConnectionIds, GameState State);

	/// <summary>Null = broadcast the state as-is to the game group (no hidden information).</summary>
	public static List<Send>? PlanPerPlayer(GameState state, IGameFamily family,
		Func<string, IReadOnlyList<string>> connectionsForPlayer)
	{
		if (!family.HasHiddenInformation)
		{
			return null;
		}

		var sends = new List<Send>();
		foreach (var player in state.Players)
		{
			var connections = connectionsForPlayer(player.Id);
			if (connections.Count == 0)
			{
				continue;
			}

			sends.Add(new Send(connections, family.ProjectFor(state, player.Id)));
		}
		return sends;
	}
}
