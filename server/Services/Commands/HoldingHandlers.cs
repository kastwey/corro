using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Handles paying release cost to get out of holding.
/// Validates and delegates to CorroRulebook.
/// </summary>
public class PayReleaseCostHandler : ICommandHandler<PayReleaseCostCommand>
{
	private readonly ICorroRulebook _rulebook;

	public PayReleaseCostHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(PayReleaseCostCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var outcome = await _rulebook.PayReleaseCostAsync(player, context);

		if (outcome.AsError() is { } outcomeError)
		{
			return outcomeError;
		}

		context.Logger?.LogDebug("{PlayerName} paid {Amount}€ release cost and is released from holding", player.Name, outcome.AmountPaid);

		return new ReleaseCostPaidResponse
		{
			PlayerId = player.Id,
			PlayerName = player.Name,
			Amount = outcome.AmountPaid ?? 0
		};
	}
}

/// <summary>
/// Handler for using a release pass.
/// Validates and delegates to CorroRulebook.
/// </summary>
public class UseReleasePassHandler : ICommandHandler<UseReleasePassCommand>
{
	private readonly ICorroRulebook _rulebook;

	public UseReleasePassHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(UseReleasePassCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var outcome = await _rulebook.UseReleasePassAsync(player, context);

		if (outcome.AsError() is { } outcomeError)
		{
			return outcomeError;
		}

		context.Logger?.LogDebug("{PlayerName} used a release pass", player.Name);

		return new ReleasePassUsedResponse
		{
			PlayerId = player.Id,
			PlayerName = player.Name,
			CardsRemaining = outcome.CardsRemaining ?? 0
		};
	}
}
