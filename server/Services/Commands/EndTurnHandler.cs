using System.Linq;
using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Handles the EndTurn command - passes turn to the next player.
///
/// The turn never auto-advances; ending it is an explicit player action. This handler
/// enforces the turn-phase rules: the player must have rolled, must not owe another
/// roll (doubles), and must have no unresolved debt. A still-pending purchase is
/// resolved as "do not buy" (auction if the smallBuilding rule is enabled, otherwise discarded).
/// </summary>
public class EndTurnHandler : ICommandHandler<EndTurnCommand>
{
	private readonly ICorroRulebook _rulebook;

	public EndTurnHandler(ICorroRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(EndTurnCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		// Only the player whose turn it is may end it. Without this guard another player
		// could pass the turn — and, since HasRolledThisTurn reflects the CURRENT player,
		// effectively "end the turn without having rolled" themselves.
		if (context.GameState.CurrentTurn != command.PlayerId)
		{
			return new ErrorResponse { Message = "Not your turn", Code = "NOT_YOUR_TURN" };
		}

		// Must have rolled before ending the turn.
		if (!context.GameState.HasRolledThisTurn)
		{
			return new ErrorResponse { Message = "You must roll before ending your turn", Code = "NOT_ROLLED_YET" };
		}

		// Doubles owe another roll first.
		if (context.GameState.MustRollAgain)
		{
			return new ErrorResponse { Message = "You rolled doubles and must roll again", Code = "MUST_ROLL_AGAIN" };
		}

		// Outstanding debt must be resolved before passing the turn.
		if (context.GameState.PendingDebts.Any(d => d.DebtorId == player.Id))
		{
			return new ErrorResponse { Message = "Resolve your debt before ending your turn", Code = "RESOLVE_DEBT_FIRST" };
		}

		// A still-pending purchase counts as "do not buy". Resolve it; if that starts an
		// auction, the turn does not advance yet because the auction completes the handover.
		if (context.GameState.PendingPurchase is { } pending && pending.PlayerId == player.Id)
		{
			var decline = await _rulebook.DeclinePropertyAsync(player, pending.SquareIndex, context);
			if (decline.AsError() is { } declineError)
			{
				return declineError;
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

		// No obligations remain: pass the turn.
		context.Helper.NextTurn();
		var currentPlayer = context.Helper.GetCurrentPlayer();

		await context.Announce("game.turn_of", new Dictionary<string, object>
		{
			["player"] = currentPlayer?.Name ?? "",
			["actorId"] = currentPlayer?.Id ?? ""
		});

		return new TurnAnnouncementResponse { CurrentPlayer = currentPlayer?.Name };
	}
}
