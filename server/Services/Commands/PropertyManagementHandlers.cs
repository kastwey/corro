using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Handler for mortgage property command.
/// Validates and delegates to CorroRulebook.
/// </summary>
public class MortgagePropertyHandler : PlayerCommandHandler<MortgagePropertyCommand>
{
	private readonly ICorroRulebook _rulebook;

	public MortgagePropertyHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	protected override async Task<ServerResponse> HandleAsync(MortgagePropertyCommand command, Player player, GameContext context)
	{
		context.Logger?.LogDebug("MortgagePropertyHandler: {PlayerId} mortgaging square {SquareIndex}", command.PlayerId, command.SquareIndex);

		var outcome = await _rulebook.MortgagePropertyAsync(player, command.SquareIndex, context);

		if (outcome.AsError() is { } outcomeError)
		{
			return outcomeError;
		}

		context.Logger?.LogDebug("{PlayerName} mortgaged {SquareName} for {Amount}€", player.Name, outcome.SquareName, outcome.AmountChanged);

		return new PropertyMortgagedResponse
		{
			PlayerId = player.Id,
			PlayerName = player.Name,
			SquareIndex = outcome.SquareIndex,
			SquareName = outcome.SquareName ?? string.Empty,
			AmountReceived = outcome.AmountChanged,
			PlayerMoney = outcome.PlayerMoney,
			RemainingDebt = outcome.RemainingDebt
		};
	}
}

/// <summary>
/// Handler for unmortgage property command.
/// Validates and delegates to CorroRulebook.
/// </summary>
public class UnmortgagePropertyHandler : PlayerCommandHandler<UnmortgagePropertyCommand>
{
	private readonly ICorroRulebook _rulebook;

	public UnmortgagePropertyHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	protected override async Task<ServerResponse> HandleAsync(UnmortgagePropertyCommand command, Player player, GameContext context)
	{
		context.Logger?.LogDebug("UnmortgagePropertyHandler: {PlayerId} unmortgaging square {SquareIndex}", command.PlayerId, command.SquareIndex);

		var outcome = await _rulebook.UnmortgagePropertyAsync(player, command.SquareIndex, context);

		if (outcome.AsError() is { } outcomeError)
		{
			return outcomeError;
		}

		context.Logger?.LogDebug("{PlayerName} unmortgaged {SquareName} for {Amount}€", player.Name, outcome.SquareName, outcome.AmountChanged);

		return new PropertyUnmortgagedResponse
		{
			PlayerId = player.Id,
			PlayerName = player.Name,
			SquareIndex = outcome.SquareIndex,
			SquareName = outcome.SquareName ?? string.Empty,
			AmountPaid = outcome.AmountChanged,
			PlayerMoney = outcome.PlayerMoney
		};
	}
}

/// <summary>
/// Handler for sell smallBuildings command.
/// Validates and delegates to CorroRulebook.
/// </summary>
public class SellBuildingsHandler : PlayerCommandHandler<SellBuildingsCommand>
{
	private readonly ICorroRulebook _rulebook;

	public SellBuildingsHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	protected override async Task<ServerResponse> HandleAsync(SellBuildingsCommand command, Player player, GameContext context)
	{
		context.Logger?.LogDebug("SellBuildingsHandler: {PlayerId} selling {Count} smallBuildings on square {SquareIndex}", command.PlayerId, command.Count, command.SquareIndex);

		// For now, sell one smallBuilding at a time
		var totalSaleValue = 0;
		var totalCount = 0;

		for (int i = 0; i < command.Count; i++)
		{
			var outcome = await _rulebook.SellBuildingAsync(player, command.SquareIndex, context);
			if (!outcome.Success)
			{
				if (totalCount == 0)
				{
					return outcome.AsError()!;
				}
				break;
			}
			totalSaleValue += outcome.AmountChanged;
			totalCount++;
		}

		var square = context.Helper.GetSquare(command.SquareIndex);

		context.Logger?.LogDebug("{PlayerName} sold {Count} buildings on {SquareName} for {Amount}€", player.Name, totalCount, square?.Name, totalSaleValue);

		// Server owns the voice: a single aggregated announcement (the rulebook no
		// longer announces per-smallBuilding). First-person via actorId.
		if (totalCount > 0)
		{
			await context.Announce("game.buildings_sold", new Dictionary<string, object>
			{
				["actorId"] = player.Id,
				["player"] = player.Name,
				["property"] = square?.Name ?? string.Empty,
				["count"] = totalCount,
				["amount"] = totalSaleValue
			});
		}

		return new BuildingsSoldResponse
		{
			PlayerId = player.Id,
			PlayerName = player.Name,
			SquareIndex = command.SquareIndex,
			SquareName = square?.Name ?? string.Empty,
			Count = totalCount,
			AmountReceived = totalSaleValue,
			RemainingBuildings = (square?.SmallBuildings ?? 0) + (square?.BigBuildings ?? 0) * 5,
			PlayerMoney = player.Money,
			RemainingDebt = context.GameState.PendingDebts
				.Where(d => d.DebtorId == command.PlayerId)
				.Sum(d => d.Amount)
		};
	}
}

/// <summary>
/// Handler for build smallBuilding command.
/// Validates and delegates to CorroRulebook.
/// </summary>
public class BuildHandler : PlayerCommandHandler<BuildCommand>
{
	private readonly ICorroRulebook _rulebook;

	public BuildHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	protected override async Task<ServerResponse> HandleAsync(BuildCommand command, Player player, GameContext context)
	{
		context.Logger?.LogDebug("BuildHandler: {PlayerId} building {Count} on square {SquareIndex}", command.PlayerId, command.Count, command.SquareIndex);

		// Build one smallBuilding at a time so the even-building rule is enforced per step.
		var totalSpent = 0;
		var totalCount = 0;
		var count = command.Count < 1 ? 1 : command.Count;

		for (int i = 0; i < count; i++)
		{
			var outcome = await _rulebook.BuildAsync(player, command.SquareIndex, context);
			if (!outcome.Success)
			{
				if (totalCount == 0)
				{
					return outcome.AsError()!;
				}
				break;
			}
			totalSpent += -outcome.AmountChanged;
			totalCount++;
		}

		var square = context.Helper.GetSquare(command.SquareIndex);

		context.Logger?.LogDebug("{PlayerName} built {Count} on {SquareName} for {Amount}€", player.Name, totalCount, square?.Name, totalSpent);

		return new BuildingBuiltResponse
		{
			PlayerId = player.Id,
			PlayerName = player.Name,
			SquareIndex = command.SquareIndex,
			SquareName = square?.Name ?? string.Empty,
			Count = totalCount,
			AmountSpent = totalSpent,
			SmallBuildings = square?.SmallBuildings ?? 0,
			BigBuildings = square?.BigBuildings ?? 0,
			PlayerMoney = player.Money
		};
	}
}
