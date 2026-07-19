using CorroServer.Models;

namespace CorroServer.Services.Commands;

/// <summary>
/// Handles the GetMoney command - announces player's current money.
/// </summary>
public class GetMoneyHandler : ICommandHandler<GetMoneyCommand>
{
	public async Task<ServerResponse> HandleAsync(GetMoneyCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var money = context.Helper.GetPlayerMoney(command.PlayerId);
		await context.Announce("game.player_money", new Dictionary<string, object>
		{
			["player"] = player.Name,
			["amount"] = money
		});

		return new PlayerMoneyResponse { PlayerId = command.PlayerId, Amount = money };
	}
}

/// <summary>
/// Handles the GetReleasePasses command - announces player's holding free cards.
/// </summary>
public class GetReleasePassesHandler : ICommandHandler<GetReleasePassesCommand>
{
	public async Task<ServerResponse> HandleAsync(GetReleasePassesCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var releasePasses = context.Helper.GetPlayerReleasePasses(command.PlayerId);
		var key = releasePasses > 0
			? (releasePasses == 1 ? "game.release_passes_one" : "game.release_passes_multiple")
			: "game.release_passes_none";

		await context.Announce(key, new Dictionary<string, object>
		{
			["player"] = player.Name,
			["count"] = releasePasses
		});

		return new PlayerReleasePassesResponse { PlayerId = command.PlayerId, Count = releasePasses };
	}
}

/// <summary>
/// Handles the AnnounceTurn command - announces whose turn it is.
/// </summary>
public class AnnounceTurnHandler : ICommandHandler<AnnounceTurnCommand>
{
	public async Task<ServerResponse> HandleAsync(AnnounceTurnCommand command, GameContext context)
	{
		var currentPlayer = context.Helper.GetCurrentPlayer();
		var key = currentPlayer != null ? "game.turn_of" : "game.no_current_player";

		await context.Announce(key, new Dictionary<string, object>
		{
			["player"] = currentPlayer?.Name ?? "",
			["actorId"] = currentPlayer?.Id ?? ""
		});

		return new TurnAnnouncementResponse { CurrentPlayer = currentPlayer?.Name };
	}
}
