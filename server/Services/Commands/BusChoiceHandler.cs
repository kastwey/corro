using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>Validates and resolves the movement choice produced by a bonus-die Bus face.</summary>
public sealed class BusChoiceHandler : ICommandHandler<BusChoiceCommand>
{
	private readonly ICorroRulebook _rulebook;

	public BusChoiceHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(BusChoiceCommand command, GameContext context)
	{
		var pending = context.GameState.PendingBusChoice;
		if (pending is null)
		{
			return new ErrorResponse { Message = "No pending Bus choice", Code = "NO_PENDING_BUS" };
		}
		if (pending.PlayerId != command.PlayerId)
		{
			return new ErrorResponse { Message = "This Bus choice belongs to another player", Code = "NOT_YOUR_BUS" };
		}
		if (command.Choice is not ("die1" or "die2" or "both"))
		{
			return new ErrorResponse
			{
				Message = "Invalid choice. Use 'die1', 'die2', or 'both'",
				Code = "INVALID_CHOICE"
			};
		}
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var outcome = await _rulebook.ProcessBusChoiceAsync(player, command.Choice, context);
		return outcome.ToResponse(player.Id, player.Name);
	}
}
