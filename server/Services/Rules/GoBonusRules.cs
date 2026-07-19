using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

/// <summary>
/// Single source of truth for the GO bonus awarded when a movement crosses or
/// lands on GO. Both natural dice movement and card teleports funnel through here
/// so the rule (money, lap counting and the announcement) lives in exactly one
/// place instead of being duplicated per movement path.
/// </summary>
public static class GoBonusRules
{
	/// <summary>
	/// Awards the GO bonus (if any) for a move from <paramref name="fromPosition"/>
	/// to <paramref name="toPosition"/>, increments the lap counter when GO is
	/// crossed, and announces the result.
	/// </summary>
	/// <param name="doubleOnLanding">
	/// When <c>true</c> (natural dice movement) landing exactly on GO pays the
	/// double landing bonus; when <c>false</c> (card teleport) it pays the
	/// standard pass bonus.
	/// </param>
	public static async Task AwardForMoveAsync(
		Player player,
		int fromPosition,
		int toPosition,
		bool doubleOnLanding,
		GameContext context)
	{
		var landedOnGo = toPosition == 0 && fromPosition != 0;
		var crossedGo = BoardCoordinates.DidPassThroughGo(fromPosition, toPosition);

		if (!crossedGo && !landedOnGo)
		{
			return;
		}

		// Crossing GO completes a lap for statistics and package-defined rules.
		player.LapsCompleted++;
		context.Logger?.LogDebug("{PlayerName} completed lap #{Laps}", player.Name, player.LapsCompleted);

		// The GO salary is configurable; landing exactly on GO pays double only when the
		// "double salary on GO" smallBuilding rule is enabled and this is a natural dice move.
		var passBonus = context.Settings.GoBonus;
		var payDouble = landedOnGo && doubleOnLanding && context.Settings.DoubleGoSalary;
		var amount = payDouble ? passBonus * 2 : passBonus;
		context.Helper.AddPlayerMoney(player.Id, amount);
		context.Helper.SetBankMoney(context.Helper.GetBankMoney() - amount);

		await context.Announce(
			// The special "landed exactly on GO" message only makes sense when it actually
			// pays the double salary; otherwise landing on GO is identical to passing it.
			payDouble ? "game.landed_on_go" : "game.passed_through_go",
			new Dictionary<string, object>
			{
				{ "player", player.Name },
				{ "amount", amount },
				{ "actorId", player.Id }
			});
	}
}
