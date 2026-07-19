using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro;

/// <summary>
/// Applies a declarative <see cref="CardOutcome"/> (resolved by <see cref="CardEffectInterpreter"/>)
/// to the game, by delegating to the same <see cref="ICardActions"/> primitives the legacy cards
/// use. The interpreter stays pure; this is the one place a package card's effect becomes a real
/// mutation — so any board's deck plays through the existing, tested effect primitives.
/// </summary>
public static class CardOutcomeApplier
{
	public static async Task ApplyAsync(CardOutcome outcome, Player player, ICardActions actions, GameContext context)
	{
		switch (outcome.Kind)
		{
			case CardOutcomeKind.MoveTo:
				// A movement card may change the rent due on arrival (the classic "nearest railway:
				// pay double" / "nearest utility: 10× dice" rules). Set the same transient modifier
				// the legacy cards use, and always clear it so it never leaks into a later landing.
				var needsModifier = outcome.RentMultiplier != 1 || outcome.UtilityTimesDice;
				if (needsModifier)
				{
					context.PendingRentModifier = new RentModifier
					{
						Multiplier = outcome.RentMultiplier,
						UtilityTenTimesDice = outcome.UtilityTimesDice,
					};
				}

				try
				{
					await actions.MoveToSquareAsync(player, outcome.Position, outcome.CollectPass, context);
				}
				finally
				{
					if (needsModifier)
					{
						context.PendingRentModifier = null;
					}
				}
				break;
			case CardOutcomeKind.MoneyDelta:
				if (outcome.Amount >= 0)
				{
					actions.CollectFromBank(player, outcome.Amount, context);
				}
				else
				{
					actions.PayToBank(player, -outcome.Amount, context);
				}

				break;
			case CardOutcomeKind.CollectFromEach:
				await actions.CollectFromAllPlayersAsync(player, outcome.Amount, context);
				break;
			case CardOutcomeKind.PayEach:
				await actions.PayAllPlayersAsync(player, outcome.Amount, context);
				break;
			case CardOutcomeKind.PayPerBuilding:
				await actions.PayRepairsAsync(player, outcome.PerSmallBuilding, outcome.PerBigBuilding, context);
				break;
			case CardOutcomeKind.SendToHolding:
				await actions.SendToHoldingByCardAsync(player, context);
				break;
			case CardOutcomeKind.GrantReleasePass:
				actions.ReceiveReleasePass(player, context);
				break;
			case CardOutcomeKind.None:
			default:
				break;
		}
	}
}
