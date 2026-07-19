using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Handler for proposing a player-to-player trade. Validates the players, builds the pending
/// <see cref="TradeState"/> and delegates to the rulebook, which freezes the game.
/// </summary>
public class ProposeTradeHandler : ICommandHandler<ProposeTradeCommand>
{
	private readonly ICorroRulebook _rulebook;

	public ProposeTradeHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(ProposeTradeCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var initiator) is { } error)
		{
			return error;
		}

		var target = context.Helper.GetPlayer(command.TargetPlayerId);
		if (target == null)
		{
			return new ErrorResponse { Message = "Trade target not found", Code = "TARGET_NOT_FOUND" };
		}

		var trade = new TradeState
		{
			Id = Guid.NewGuid().ToString("N"),
			InitiatorId = initiator.Id,
			InitiatorName = initiator.Name,
			TargetId = target.Id,
			TargetName = target.Name,
			Initiator = new TradeOffer
			{
				Properties = command.OfferedProperties.ToList(),
				Money = command.OfferedMoney,
				ReleasePasses = command.OfferedReleasePasses
			},
			Target = new TradeOffer
			{
				Properties = command.RequestedProperties.ToList(),
				Money = command.RequestedMoney,
				ReleasePasses = command.RequestedReleasePasses
			}
		};

		var outcome = await _rulebook.ProposeTradeAsync(trade, context);
		if (outcome.AsError() is { } outcomeError)
		{
			return outcomeError;
		}

		return new TradeProposedResponse
		{
			TradeId = trade.Id,
			InitiatorId = trade.InitiatorId,
			InitiatorName = trade.InitiatorName,
			TargetId = trade.TargetId,
			TargetName = trade.TargetName,
			Offered = BuildSide(trade.Initiator, context),
			Requested = BuildSide(trade.Target, context)
		};
	}

	/// <summary>Expands a stored offer into a UI-ready DTO with property display data.</summary>
	private static TradeSideDto BuildSide(TradeOffer offer, GameContext context) => new()
	{
		Properties = offer.Properties.Select(idx =>
		{
			var sq = context.Helper.GetSquare(idx);
			return new TradePropertyDto
			{
				Index = idx,
				Name = sq?.Name ?? $"#{idx}",
				Color = sq?.Color,
				GroupNameKey = sq?.GroupNameKey,
				Price = sq?.Price
			};
		}).ToList(),
		Money = offer.Money,
		ReleasePasses = offer.ReleasePasses
	};
}

/// <summary>
/// Handler for the target's response (accept / decline) to a pending trade.
/// </summary>
public class RespondTradeHandler : ICommandHandler<RespondTradeCommand>
{
	private readonly ICorroRulebook _rulebook;

	public RespondTradeHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(RespondTradeCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var responder) is { } error)
		{
			return error;
		}

		var outcome = command.Accept
			? await _rulebook.AcceptTradeAsync(responder.Id, command.TradeId, context)
			: await _rulebook.DeclineTradeAsync(responder.Id, command.TradeId, context);

		if (outcome.AsError() is { } outcomeError)
		{
			return outcomeError;
		}

		return BuildResolved(outcome);
	}

	internal static TradeResolvedResponse BuildResolved(TradeOutcome outcome) => new()
	{
		TradeId = outcome.Trade!.Id,
		Outcome = outcome.Outcome,
		InitiatorId = outcome.Trade.InitiatorId,
		TargetId = outcome.Trade.TargetId
	};
}

/// <summary>
/// Handler for the initiator cancelling their own pending trade.
/// </summary>
public class CancelTradeHandler : ICommandHandler<CancelTradeCommand>
{
	private readonly ICorroRulebook _rulebook;

	public CancelTradeHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(CancelTradeCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var initiator) is { } error)
		{
			return error;
		}

		var outcome = await _rulebook.CancelTradeAsync(initiator.Id, command.TradeId, context);
		if (outcome.AsError() is { } outcomeError)
		{
			return outcomeError;
		}

		return RespondTradeHandler.BuildResolved(outcome);
	}
}
