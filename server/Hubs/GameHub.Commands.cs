using CorroServer.Models;
using CorroServer.Services;
using Microsoft.AspNetCore.SignalR;

namespace CorroServer.Hubs;

/// <summary>
/// The in-game half of the hub: ONE entry point for every player action.
///
/// <see cref="GameCommand"/> is polymorphic on the wire (see its derived-type allowlist), so a
/// roll, a card play and a mortgage all arrive here and take the identical path — auth, caller
/// identity, game lookup, dispatch, response routing, snapshot, cleanup. Adding an action is a
/// command record plus a handler; this file does not change.
/// </summary>
public partial class GameHub
{
	/// <summary>
	/// Executes one player command. <paramref name="command"/> deserializes only into a type on
	/// <see cref="GameCommand"/>'s derived-type allowlist, and must carry the CALLER's own player
	/// id — acting for someone else is rejected before the game service ever sees it.
	/// </summary>
	public async Task ExecuteCommand(GameCommand command)
	{
		try
		{
			if (!IsConnectionAuthenticated(out var playerId, out var gameId))
			{
				await Clients.Caller.SendAsync("Error", "NOT_AUTHENTICATED");
				_logger?.LogWarning("SECURITY: Unauthenticated command attempt from {ConnectionId}", Context.ConnectionId);
				return;
			}

			if (!_registry.TryGetService(gameId!, out var gameService))
			{
				await Clients.Caller.SendAsync("Error", "GAME_SERVICE_NOT_FOUND");
				return;
			}

			if (command.PlayerId != playerId)
			{
				await Clients.Caller.SendAsync("Error", "CANNOT_EXECUTE_FOR_OTHERS");
				_logger?.LogWarning("SECURITY: Player {PlayerId} tried to execute command for {TargetPlayerId}", playerId, command.PlayerId);
				return;
			}

			await RunCommandAsync(gameId!, gameService, command);
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in ExecuteCommand");
			await Clients.Caller.SendAsync("Error", "COMMAND_EXECUTION_ERROR");
		}
	}

	/// <summary>
	/// Dispatch one already-authorised command and do everything that must follow it: route the
	/// response, flush the authoritative snapshot, open an auction the command started, and retire
	/// the match if it ended. Extracted so a command the SERVER raises on a player's behalf — a
	/// forfeit when they abandon a table mid-match — takes exactly the same path as one they sent
	/// themselves, instead of a private shortcut that silently skips the snapshot or the cleanup.
	/// </summary>
	private async Task RunCommandAsync(string gameId, IGameService gameService, GameCommand command)
	{
		var response = await gameService.ExecuteCommandAsync(command);

		// A response is private to the caller unless it says otherwise: everyone else learns
		// what happened through the announcements and the new state. The few that must reach a
		// player who sent no command declare it themselves (ServerResponse.ReachesEveryPlayer),
		// each with its own reason — so this stays a routing decision, not a list of type names
		// the hub has to keep in step with the responses.
		if (response.ReachesEveryPlayer)
		{
			await Clients.Group(gameId).SendAsync("CommandResponse", response);
		}
		else
		{
			await Clients.Caller.SendAsync("CommandResponse", response);
		}
		// ExecuteCommandAsync does not return until this command's GameEvents batch has
		// been sent. Keep the authoritative snapshot here, after that flush (and after the
		// response handlers that arm movement), so no ordinary handler can make a hand or
		// board repaint overtake its narration. Mid-command snapshots use the explicitly
		// ordered CheckpointTurnSegmentAsync path instead.
		await gameService.NotifyStateChangedAsync();

		// Free finished games so they don't accumulate in memory.
		await _registry.CleanupIfGameOverAsync(gameId, gameService);
	}
}
