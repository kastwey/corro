using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Dispatches commands to their appropriate handlers.
/// This is the central point for command execution, following OCP.
/// </summary>
public class CommandDispatcher
{
	private readonly Dictionary<Type, Func<GameCommand, GameContext, Task<ServerResponse>>> _handlers = new();

	public CommandDispatcher(ICorroRulebook rulebook, IAuctionRulebook auctionRulebook)
	{
		// Register all command handlers
		RegisterHandler(new RollDiceHandler(rulebook));
		RegisterHandler(new BuyPropertyHandler(rulebook));
		RegisterHandler(new EndTurnHandler(rulebook));
		RegisterHandler(new GetMoneyHandler());
		RegisterHandler(new GetReleasePassesHandler());
		RegisterHandler(new AnnounceTurnHandler());

		RegisterHandler(new MoveRacePieceHandler());

		// Journey family handlers (draw → play/discard, coup fourré answer). Play/discard
		// carry the rulebook for its randomness source: a finished hand redeals through it.
		RegisterHandler(new JourneyDrawHandler());
		RegisterHandler(new JourneyPlayHandler(rulebook));
		RegisterHandler(new JourneyDiscardHandler(rulebook));
		RegisterHandler(new JourneyCoupHandler());

		// Assembly family handlers (play/discard; the end-of-turn refill reshuffles the
		// face-down discards through the rulebook's randomness source).
		RegisterHandler(new AssemblyPlayHandler(rulebook));
		RegisterHandler(new AssemblyDiscardHandler(rulebook));

		// Draft family handler (the simultaneous pick; reveal/pass/scoring cascade from it).
		RegisterHandler(new DraftPickHandler());

		// Shedding family handlers (play/draw/keep; draws may reshuffle the buried
		// discards through the rulebook's randomness source).
		RegisterHandler(new SheddingPlayHandler(rulebook));
		RegisterHandler(new SheddingDrawHandler(rulebook));
		RegisterHandler(new SheddingKeepHandler());
		RegisterHandler(new SheddingDeclareLastCardHandler());
		RegisterHandler(new SheddingCatchLastCardHandler(rulebook));

		// Exploding family handlers (play an action → the Nope window; the timer-driven
		// window resolution and the draw's shuffle carry the rulebook's randomness source).
		RegisterHandler(new ExplodingPlayHandler());
		RegisterHandler(new ExplodingNopeHandler());
		RegisterHandler(new ExplodingDrawHandler(rulebook));
		RegisterHandler(new ExplodingDefuseHandler());
		RegisterHandler(new ExplodingGiveHandler());
		RegisterHandler(new ExplodingResolveWindowHandler(rulebook));

		// Trivia family handlers (choose judge at start → move after a roll → answer → judge).
		// A dice roll dispatches through the family's ProcessRoll, so no roll handler is needed.
		RegisterHandler(new TriviaChooseJudgeHandler());
		RegisterHandler(new TriviaMoveHandler());
		RegisterHandler(new TriviaAnswerHandler());
		RegisterHandler(new TriviaJudgeHandler());

		// Holding handlers
		RegisterHandler(new PayReleaseCostHandler(rulebook));
		RegisterHandler(new UseReleasePassHandler(rulebook));

		// Auction handlers
		RegisterHandler(new PlaceBidHandler(auctionRulebook));
		RegisterHandler(new PassAuctionHandler(auctionRulebook));
		RegisterHandler(new EndAuctionHandler(auctionRulebook));

		// Property management handlers
		RegisterHandler(new MortgagePropertyHandler(rulebook));
		RegisterHandler(new UnmortgagePropertyHandler(rulebook));
		RegisterHandler(new SellBuildingsHandler(rulebook));
		RegisterHandler(new BuildHandler(rulebook));

		// Debt & bankruptcy handlers
		RegisterHandler(new DeclareBankruptcyHandler(rulebook));
		RegisterHandler(new GetDebtStatusHandler(rulebook));
		RegisterHandler(new ResolveDebtHandler(rulebook));

		// Trade handlers
		RegisterHandler(new ProposeTradeHandler(rulebook));
		RegisterHandler(new RespondTradeHandler(rulebook));
		RegisterHandler(new CancelTradeHandler(rulebook));
	}

	/// <summary>
	/// Registers a command handler for a specific command type. The handler is wrapped
	/// in a typed delegate so dispatch needs no reflection.
	/// </summary>
	public void RegisterHandler<TCommand>(ICommandHandler<TCommand> handler) where TCommand : GameCommand
	{
		_handlers[typeof(TCommand)] = (command, context) => handler.HandleAsync((TCommand)command, context);
	}

	/// <summary>
	/// Server-authoritative turn guard. Turn-bound commands (<see cref="GameCommand.RequiresTurn"/>)
	/// may only be executed by the player whose turn it currently is. Returns the error code to
	/// reject the command with, or null when it is allowed to proceed. Pure so it can be unit-tested
	/// without constructing a dispatcher.
	/// </summary>
	public static string? CheckTurn(GameCommand command, string? currentTurn)
		=> command.RequiresTurn && command.PlayerId != currentTurn ? "NOT_YOUR_TURN" : null;

	/// <summary>
	/// Trade freeze guard. While a player-to-player trade is pending, every state-mutating
	/// command is rejected EXCEPT the trade response (accept / decline) and cancellation, which
	/// are the only ways to resolve it. Read-only queries (<see cref="GameCommand.MutatesState"/>
	/// false) keep working so players can still inspect the board. Returns the rejection error
	/// code, or null when the command may proceed. Pure for unit testing.
	/// </summary>
	public static string? CheckTradeFreeze(GameCommand command, GameState state)
	{
		if (state.ActiveTrade is not { IsActive: true })
		{
			return null;
		}

		if (command is RespondTradeCommand or CancelTradeCommand)
		{
			return null;
		}

		return command.MutatesState ? "TRADE_IN_PROGRESS" : null;
	}

	/// <summary>
	/// Auction freeze guard. While an auction is running the game is frozen the same way a trade
	/// freezes it: every state-mutating command is rejected EXCEPT the auction actions (bid / pass)
	/// and the auction-ending command — the bid timeout ends the auction through the dispatcher too,
	/// so <see cref="EndAuctionCommand"/> must stay allowed. Read-only queries keep working so
	/// players can still inspect the board. Without this the player who declined the purchase — who
	/// remains the current turn holder until the auction resolves — could roll again on doubles
	/// (playtest #9) or open a trade that then freezes everyone, including the auction's own bids
	/// (playtest #6). Returns the rejection error code, or null when the command may proceed. Pure
	/// for unit testing.
	/// </summary>
	public static string? CheckAuctionFreeze(GameCommand command, GameState state)
	{
		if (state.ActiveAuction is not { IsActive: true })
		{
			return null;
		}

		if (command is PlaceBidCommand or PassAuctionCommand or EndAuctionCommand)
		{
			return null;
		}

		return command.MutatesState ? "AUCTION_IN_PROGRESS" : null;
	}

	/// <summary>
	/// Dispatches a command to its handler and returns the response.
	/// </summary>
	public Task<ServerResponse> DispatchAsync(GameCommand command, GameContext context)
	{
		// Enforce turn ownership on the server before anything else. A turn-bound command issued
		// by anyone other than the current player is rejected outright, no matter what the client did.
		var turnError = CheckTurn(command, context.Helper.GetCurrentTurn());
		if (turnError != null)
		{
			return Task.FromResult<ServerResponse>(new ErrorResponse
			{
				Message = "It is not your turn",
				Code = turnError
			});
		}

		// While a trade is pending the game is frozen: only the trade response / cancellation
		// and read-only queries are allowed through.
		var tradeError = CheckTradeFreeze(command, context.GameState);
		if (tradeError != null)
		{
			return Task.FromResult<ServerResponse>(new ErrorResponse
			{
				Message = "A trade is in progress",
				Code = tradeError
			});
		}

		// Likewise, while an auction is running only bids, passes and the auction-ending command
		// (plus read-only queries) get through — the declining player is still the current turn
		// holder, so this stops them rolling again or opening a game-freezing trade mid-auction.
		var auctionError = CheckAuctionFreeze(command, context.GameState);
		if (auctionError != null)
		{
			return Task.FromResult<ServerResponse>(new ErrorResponse
			{
				Message = "An auction is in progress",
				Code = auctionError
			});
		}

		if (!_handlers.TryGetValue(command.GetType(), out var handler))
		{
			return Task.FromResult<ServerResponse>(new ErrorResponse
			{
				Message = $"No handler registered for command type: {command.GetType().Name}",
				Code = "UNKNOWN_COMMAND"
			});
		}

		return handler(command, context);
	}

}
