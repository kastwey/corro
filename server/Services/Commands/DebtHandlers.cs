using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Handler for declare bankruptcy command.
/// Validates and delegates to CorroRulebook.
/// </summary>
public class DeclareBankruptcyHandler : ICommandHandler<DeclareBankruptcyCommand>
{
	private readonly ICorroRulebook _rulebook;

	public DeclareBankruptcyHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(DeclareBankruptcyCommand command, GameContext context)
	{
		context.Logger?.LogDebug("DeclareBankruptcyHandler: {PlayerId}", command.PlayerId);

		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var outcome = await _rulebook.DeclareBankruptcyAsync(player, context);

		context.Logger?.LogInformation("{PlayerName} declared bankruptcy. {Count} properties transferred.", player.Name, outcome.PropertiesTransferred.Count + outcome.PropertiesToAuction.Count);

		if (outcome.GameOver)
		{
			context.Logger?.LogInformation("GAME OVER! {WinnerName} wins!", outcome.WinnerName);
		}

		return new BankruptcyResponse
		{
			PlayerId = player.Id,
			PlayerName = player.Name,
			BeneficiaryId = outcome.BeneficiaryId,
			BeneficiaryName = outcome.BeneficiaryName,
			PropertiesTransferred = outcome.PropertiesTransferred,
			PropertiesToAuction = outcome.PropertiesToAuction,
			CashTransferred = outcome.CashTransferred,
			RemainingPlayers = outcome.RemainingPlayers,
			GameOver = outcome.GameOver,
			WinnerId = outcome.WinnerId,
			WinnerName = outcome.WinnerName
		};
	}
}

/// <summary>
/// Handler for get debt status command - a query that reports the player's debts and the
/// assets they could liquidate. It shares the rulebook's valuation so the figure shown to
/// the player matches the one that triggers forced bankruptcy (assets &lt; debt).
/// </summary>
public class GetDebtStatusHandler : ICommandHandler<GetDebtStatusCommand>
{
	private readonly ICorroRulebook _rulebook;

	public GetDebtStatusHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public Task<ServerResponse> HandleAsync(GetDebtStatusCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return Task.FromResult<ServerResponse>(error);
		}

		var debts = context.GameState.PendingDebts
			.Where(d => d.DebtorId == command.PlayerId)
			.ToList();

		var totalDebt = debts.Sum(d => d.Amount);

		// Calculate mortgageable value
		var mortgageableValue = 0;
		var mortgageableProperties = new List<MortgageablePropertyDto>();

		foreach (var propIndex in player.Properties)
		{
			var square = context.Helper.GetSquare(propIndex);
			if (square != null && !square.Mortgaged && square.SmallBuildings == 0 && square.BigBuildings == 0 && square.Price.HasValue)
			{
				var value = square.Price.Value / 2;
				mortgageableValue += value;
				mortgageableProperties.Add(new MortgageablePropertyDto
				{
					SquareIndex = propIndex,
					Name = square.Name,
					MortgageValue = value,
					Color = square.Color
				});
			}
		}

		// SmallBuilding sale value uses the rulebook's resale rule (half the per-colour build cost).
		var buildingSaleValue = 0;
		foreach (var propIndex in player.Properties)
		{
			var square = context.Helper.GetSquare(propIndex);
			if (square != null)
			{
				buildingSaleValue += _rulebook.GetBuildingSaleValue(square);
			}
		}

		var totalAssets = player.Money + mortgageableValue + buildingSaleValue;

		return Task.FromResult<ServerResponse>(new DebtStatusResponse
		{
			PlayerId = player.Id,
			PlayerName = player.Name,
			TotalDebt = totalDebt,
			Cash = player.Money,
			MortgageableValue = mortgageableValue,
			BuildingSaleValue = buildingSaleValue,
			TotalAssets = totalAssets,
			CanPayDebt = totalAssets >= totalDebt,
			IsBankrupt = totalAssets < totalDebt,
			Debts = debts,
			MortgageableProperties = mortgageableProperties
		});
	}
}

/// <summary>
/// Handler for resolve debt command.
/// Validates and delegates to CorroRulebook.
/// </summary>
public class ResolveDebtHandler : ICommandHandler<ResolveDebtCommand>
{
	private readonly ICorroRulebook _rulebook;

	public ResolveDebtHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(ResolveDebtCommand command, GameContext context)
	{
		context.Logger?.LogDebug("ResolveDebtHandler: {PlayerId}", command.PlayerId);

		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var outcome = await _rulebook.ResolveDebtAsync(player, command.DebtId, context);

		if (outcome.AsError() is { } outcomeError)
		{
			return outcomeError;
		}

		context.Logger?.LogDebug("Debt resolved: {PlayerName} paid {Amount}€ to {Creditor}", player.Name, outcome.AmountPaid, outcome.CreditorName);

		return new DebtResolvedResponse
		{
			DebtId = outcome.DebtId ?? string.Empty,
			DebtorId = player.Id,
			DebtorName = player.Name,
			CreditorId = null,
			CreditorName = outcome.CreditorName,
			Amount = outcome.AmountPaid,
			RemainingDebts = outcome.RemainingDebts
		};
	}
}
