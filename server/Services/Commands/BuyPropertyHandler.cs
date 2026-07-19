using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Handles the BuyProperty command - purchases a property for the current player.
/// Validates and delegates to CorroRulebook.
/// </summary>
public class BuyPropertyHandler : ICommandHandler<BuyPropertyCommand>
{
	private readonly ICorroRulebook _rulebook;

	public BuyPropertyHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(BuyPropertyCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var outcome = await _rulebook.BuyPropertyAsync(player, command.SquareIndex, context);

		if (outcome.AsError() is { } outcomeError)
		{
			return outcomeError;
		}

		// Note: the announcement is emitted by CorroRulebook.BuyPropertyAsync,
		// which owns the authoritative game data. The handler only shapes the response.
		var (nextPlayerId, nextPlayerName) = context.Helper.GetNextTurnInfo(player.Id);

		return new PropertyPurchasedResponse
		{
			PlayerId = player.Id,
			PlayerName = player.Name,
			SquareIndex = outcome.SquareIndex,
			SquareName = outcome.SquareName ?? string.Empty,
			Price = outcome.Price,
			RemainingMoney = outcome.RemainingMoney,
			NextPlayerId = nextPlayerId,
			NextPlayerName = nextPlayerName
		};
	}
}
