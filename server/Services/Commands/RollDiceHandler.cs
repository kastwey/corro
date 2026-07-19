using CorroServer.Models;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Handles the RollDice command.
///
/// This handler only validates the request and delegates to the Rulebook.
/// All game logic lives in CorroRulebook.
/// </summary>
public class RollDiceHandler : ICommandHandler<RollDiceCommand>
{
	private readonly ICorroRulebook _rulebook;

	public RollDiceHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(RollDiceCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		// Validate it's this player's turn
		if (context.GameState.CurrentTurn != command.PlayerId)
		{
			return new ErrorResponse
			{
				Message = "Not your turn",
				Code = "NOT_YOUR_TURN"
			};
		}

		// A family that owns its dice flow (race/track: one die, their own turn sequence) takes
		// over here; none of the property checks below (debt, holding, doubles) apply to it. The
		// property family returns null and falls through to the shared flow.
		if (GameFamilies.For(context.GameState.GameType).ProcessRoll(_rulebook.RollSingleDie, player, context) is { } familyRoll)
		{
			return await familyRoll;
		}

		// Outstanding debt must be resolved before rolling. Without this, a player who
		// owes money (e.g. an unaffordable tax) and rolled doubles could keep rolling
		// again, skipping past the debt and leaving a phantom debt that is never
		// collected. Mirror EndTurnHandler's RESOLVE_DEBT_FIRST guard.
		if (context.GameState.PendingDebts.Any(d => d.DebtorId == player.Id))
		{
			return new ErrorResponse
			{
				Message = "Resolve your debt before rolling again",
				Code = "RESOLVE_DEBT_FIRST"
			};
		}

		// Turn-phase guard: the turn never auto-advances, so a player may roll only
		// once per turn — except after doubles, when they owe (and may take) another roll.
		if (context.GameState.HasRolledThisTurn && !context.GameState.MustRollAgain)
		{
			return new ErrorResponse
			{
				Message = "You have already rolled this turn",
				Code = "ALREADY_ROLLED"
			};
		}

		// Rolling again after doubles while a purchase is still pending counts as declining
		// that property. If that starts an auction, the player waits for it to finish before
		// taking the owed roll.
		if (context.GameState.PendingPurchase is { } pending && pending.PlayerId == player.Id)
		{
			var decline = await _rulebook.DeclinePropertyAsync(player, pending.SquareIndex, context);
			if (decline.AsError() is { } outcomeError)
			{
				return outcomeError;
			}

			if (decline.AuctionStarted)
			{
				return new PropertyDeclinedResponse
				{
					PlayerId = player.Id,
					SquareIndex = decline.SquareIndex,
					SquareName = decline.SquareName ?? string.Empty,
					AuctionStarted = true,
					NextPlayerId = null,
					NextPlayerName = null
				};
			}
		}

		// Delegate to the rulebook
		var outcome = await _rulebook.ProcessDiceRollAsync(player, context);

		// Convert to response
		return outcome.ToResponse(player.Id, player.Name);
	}
}
